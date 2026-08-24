import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";
import { isRateLimited } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { chatMessageIngestSchema, chatMessagePollSchema } from "@/lib/validation";

/**
 * Website chatbot -> Dashboard integration, visitor side. Service-token
 * authenticated (zynreach-website's own server calls this, never the
 * visitor's browser directly) — same trust boundary as
 * /api/admin/leads/ingest. `conversationToken` is the anonymous visitor
 * identity: omitted on the very first message (a new ChatConversation is
 * created and its token returned), then echoed back by the website on
 * every message after, the same "no account required" model every other
 * lead-capture form on the site already uses.
 *
 * A visitor sending again into a CLOSED conversation reopens it rather
 * than starting a new one — the public website's chat experience should
 * never fragment one visitor's history into multiple threads just
 * because a Sales user marked the earlier one resolved.
 */
export async function POST(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = chatMessageIngestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { conversationToken, body: messageBody } = parsed.data;
  const ipAddress = getClientIp(request);

  // Rate-limited per conversation once one exists (a single runaway
  // visitor can't flood their own thread); per-IP for the very first
  // message of a brand-new conversation, before a token exists to key on.
  if (isRateLimited(`chat:ingest:${conversationToken ?? ipAddress ?? "unknown"}`, 20)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let conversation = conversationToken
    ? await prisma.chatConversation.findUnique({ where: { visitorToken: conversationToken } })
    : null;

  if (conversationToken && !conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: { visitorToken: randomBytes(24).toString("base64url") },
    });
  }

  const message = await prisma.chatMessage.create({
    data: { conversationId: conversation.id, sender: "VISITOR", body: messageBody },
  });

  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: message.createdAt, status: "OPEN" },
  });

  return NextResponse.json(
    {
      status: "success",
      conversationToken: conversation.visitorToken,
      message: { id: message.id, sender: message.sender, body: message.body, createdAt: message.createdAt },
    },
    { status: 201 }
  );
}

/**
 * Website polling for new messages (agent replies) in an existing
 * conversation. `after` (ISO timestamp of the last message the website
 * already has) limits the response to what's actually new, so a poll
 * loop isn't re-fetching the full history every few seconds.
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const parsed = chatMessagePollSchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters.", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { conversationToken, after } = parsed.data;
  const conversation = await prisma.chatConversation.findUnique({ where: { visitorToken: conversationToken } });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const afterDate = after ? new Date(after) : undefined;
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id, ...(afterDate ? { createdAt: { gt: afterDate } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, sender: true, body: true, createdAt: true },
  });

  return NextResponse.json({ status: conversation.status, messages });
}
