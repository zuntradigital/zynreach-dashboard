import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth/guards";

interface FaqItemLocaleText {
  question: string;
  answer: string;
}

/**
 * Knowledge Center FAQ Public Read — the Published FaqItem list that
 * drives the website's FAQ page tabs. FaqItem is direct-save (see the
 * admin PATCH handler's docstring), so this reads status directly rather
 * than "ever published."
 */
export async function GET(request: Request) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const locale = searchParams.get("locale") === "ar" ? "ar" : "en";

  const items = await prisma.faqItem.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ category: "asc" }, { order: "asc" }, { createdAt: "asc" }],
  });

  const faqs = items.map((item) => {
    const text = (item.translations as unknown as Record<"en" | "ar", FaqItemLocaleText>)[locale];
    return {
      id: item.id,
      category: item.category,
      question: text.question,
      answer: text.answer,
    };
  });

  return NextResponse.json({ faqs });
}
