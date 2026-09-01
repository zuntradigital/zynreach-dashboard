"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { TextField } from "@/components/ui/TextField";

interface FaqLocaleText {
  question: string;
  answer: string;
}

interface FaqItem {
  id: string;
  category: string;
  order: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED" | "SUBMITTED" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED";
  translations: { en: FaqLocaleText; ar: FaqLocaleText };
  createdAt: string;
}

type PageState = { kind: "loading" } | { kind: "forbidden" } | { kind: "ready" };
type ListState = { kind: "loading" } | { kind: "error" } | { kind: "ready" };

const EMPTY_CREATE_FORM = {
  category: "",
  order: "0",
  questionEn: "",
  answerEn: "",
  questionAr: "",
  answerAr: "",
};

export default function FaqPage() {
  const t = useTranslations("dashboard.faq");
  const tCommon = useTranslations("common");
  const [pageState, setPageState] = useState<PageState>({ kind: "loading" });
  const [listState, setListState] = useState<ListState>({ kind: "loading" });
  const [items, setItems] = useState<FaqItem[]>([]);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // take is capped at PAGE_SIZE_MAX (100) server-side by
      // faqItemsQuerySchema — requesting more than that fails validation
      // with a 400, which is exactly what was causing "Unable to load
      // FAQs" on every visit to this page.
      const res = await fetch("/api/admin/faq?take=100");
      if (res.status === 403) {
        setPageState({ kind: "forbidden" });
        return;
      }
      if (!res.ok) {
        setListState({ kind: "error" });
        setPageState({ kind: "ready" });
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setListState({ kind: "ready" });
      setPageState({ kind: "ready" });
    } catch {
      setListState({ kind: "error" });
      setPageState({ kind: "ready" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const existingCategories = useMemo(() => Array.from(new Set(items.map((i) => i.category))).sort(), [items]);

  const grouped = useMemo(() => {
    const map = new Map<string, FaqItem[]>();
    for (const item of items) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  async function handleCreate() {
    const category = createForm.category.trim();
    const questionEn = createForm.questionEn.trim();
    const answerEn = createForm.answerEn.trim();
    const questionAr = createForm.questionAr.trim();
    const answerAr = createForm.answerAr.trim();
    if (!category || !questionEn || !answerEn || !questionAr || !answerAr) {
      setCreateError(t("createError"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/faq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          order: Number(createForm.order) || 0,
          translations: {
            en: { question: questionEn, answer: answerEn },
            ar: { question: questionAr, answer: answerAr },
          },
        }),
      });
      if (!res.ok) {
        setCreateError(t("createError"));
        return;
      }
      const data = await res.json();
      setItems((prev) => [...prev, data.item]);
      setCreateForm(EMPTY_CREATE_FORM);
    } catch {
      setCreateError(t("createError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (typeof window !== "undefined" && !window.confirm(t("deleteConfirm"))) return;
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/faq/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleteError(t("deleteError"));
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      setDeleteError(t("deleteError"));
    } finally {
      setDeletingId(null);
    }
  }

  if (pageState.kind === "loading") {
    return <p className="text-sm text-neutral-500">{tCommon("loading")}</p>;
  }

  if (pageState.kind === "forbidden") {
    return <p className="text-sm text-neutral-500">{t("forbidden")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t("subtitle")}</p>
      </div>

      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
          <h2 className="text-sm font-semibold text-neutral-900">{t("createTitle")}</h2>

          {createError ? (
            <div role="alert" className="mt-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
              {createError}
            </div>
          ) : null}

          <div className="mt-4 space-y-4">
            <div>
              <TextField
                label={t("categoryLabel")}
                name="category"
                value={createForm.category}
                onChange={(v) => setCreateForm((prev) => ({ ...prev, category: v }))}
                list="faq-category-options"
              />
              <datalist id="faq-category-options">
                {existingCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <p className="mt-1 text-xs text-neutral-500">{t("categoryHint")}</p>
            </div>
            <TextField
              label={t("orderLabel")}
              name="order"
              inputMode="numeric"
              value={createForm.order}
              onChange={(v) => setCreateForm((prev) => ({ ...prev, order: v }))}
            />
            <TextField
              label={t("questionLabelEn")}
              name="questionEn"
              value={createForm.questionEn}
              onChange={(v) => setCreateForm((prev) => ({ ...prev, questionEn: v }))}
            />
            <div>
              <label className="block text-sm font-medium text-neutral-700">{t("answerLabelEn")}</label>
              <textarea
                value={createForm.answerEn}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, answerEn: e.target.value }))}
                rows={3}
                className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
              />
            </div>
            <TextField
              label={t("questionLabelAr")}
              name="questionAr"
              value={createForm.questionAr}
              onChange={(v) => setCreateForm((prev) => ({ ...prev, questionAr: v }))}
              dir="rtl"
            />
            <div>
              <label className="block text-sm font-medium text-neutral-700">{t("answerLabelAr")}</label>
              <textarea
                value={createForm.answerAr}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, answerAr: e.target.value }))}
                rows={3}
                dir="rtl"
                className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {creating ? t("creating") : t("create")}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-surface shadow-card p-6">
          {listState.kind === "loading" ? <p className="text-sm text-neutral-500">…</p> : null}

          {listState.kind === "error" ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-error">{t("loadError")}</p>
              <button
                type="button"
                onClick={() => {
                  setListState({ kind: "loading" });
                  void load();
                }}
                className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
              >
                {t("retry")}
              </button>
            </div>
          ) : null}

          {listState.kind === "ready" ? (
            <>
              {deleteError ? (
                <div role="alert" className="mb-4 rounded-md bg-error-bg px-3 py-2 text-sm text-error">
                  {deleteError}
                </div>
              ) : null}
              {items.length === 0 ? (
                <p className="text-sm text-neutral-500">{t("empty")}</p>
              ) : (
                <div className="space-y-6">
                  {grouped.map(([category, categoryItems]) => (
                    <div key={category}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{category}</h3>
                      <ul className="mt-2 divide-y divide-neutral-200">
                        {categoryItems.map((item) =>
                          editingId === item.id ? (
                            <FaqEditRow
                              key={item.id}
                              item={item}
                              onCancel={() => setEditingId(null)}
                              onSaved={(updated) => {
                                setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
                                setEditingId(null);
                              }}
                            />
                          ) : (
                            <li key={item.id} className="flex items-start justify-between gap-4 py-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-neutral-900">{item.translations.en.question}</p>
                                <p className="mt-0.5 truncate text-xs text-neutral-500">{item.translations.en.answer}</p>
                                <span
                                  className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                    item.status === "PUBLISHED"
                                      ? "bg-success-bg text-success"
                                      : item.status === "ARCHIVED"
                                        ? "bg-neutral-200 text-neutral-600"
                                        : "bg-warning-bg text-warning"
                                  }`}
                                >
                                  {item.status === "PUBLISHED" ? t("statusPublished") : item.status === "ARCHIVED" ? t("statusArchived") : t("statusDraft")}
                                </span>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingId(item.id)}
                                  className="min-h-9 rounded-md px-3 text-sm font-medium text-primary-600 hover:bg-primary-50"
                                >
                                  {t("edit")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDelete(item.id)}
                                  disabled={deletingId === item.id}
                                  className="min-h-9 rounded-md px-3 text-sm font-medium text-error hover:bg-error-bg disabled:opacity-60"
                                >
                                  {deletingId === item.id ? t("deleting") : t("delete")}
                                </button>
                              </div>
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FaqEditRow({
  item,
  onCancel,
  onSaved,
}: {
  item: FaqItem;
  onCancel: () => void;
  onSaved: (item: FaqItem) => void;
}) {
  const t = useTranslations("dashboard.faq");
  const [category, setCategory] = useState(item.category);
  const [order, setOrder] = useState(String(item.order));
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED">(
    item.status === "PUBLISHED" || item.status === "ARCHIVED" ? item.status : "DRAFT"
  );
  const [questionEn, setQuestionEn] = useState(item.translations.en.question);
  const [answerEn, setAnswerEn] = useState(item.translations.en.answer);
  const [questionAr, setQuestionAr] = useState(item.translations.ar.question);
  const [answerAr, setAnswerAr] = useState(item.translations.ar.answer);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/faq/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          category: category.trim(),
          order: Number(order) || 0,
          translations: {
            en: { question: questionEn.trim(), answer: answerEn.trim() },
            ar: { question: questionAr.trim(), answer: answerAr.trim() },
          },
        }),
      });
      if (!res.ok) {
        setError(t("saveError"));
        return;
      }
      const data = await res.json();
      onSaved(data.item);
    } catch {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-3 py-3">
      {error ? (
        <div role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4">
        <TextField label={t("categoryLabel")} name={`category-${item.id}`} value={category} onChange={setCategory} />
        <TextField label={t("orderLabel")} name={`order-${item.id}`} inputMode="numeric" value={order} onChange={setOrder} />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700">{t("statusLabel")}</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "DRAFT" | "PUBLISHED" | "ARCHIVED")}
          className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
        >
          <option value="DRAFT">{t("statusDraft")}</option>
          <option value="PUBLISHED">{t("statusPublished")}</option>
          <option value="ARCHIVED">{t("statusArchived")}</option>
        </select>
      </div>
      <TextField label={t("questionLabelEn")} name={`qEn-${item.id}`} value={questionEn} onChange={setQuestionEn} />
      <div>
        <label className="block text-sm font-medium text-neutral-700">{t("answerLabelEn")}</label>
        <textarea
          value={answerEn}
          onChange={(e) => setAnswerEn(e.target.value)}
          rows={3}
          className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
        />
      </div>
      <TextField label={t("questionLabelAr")} name={`qAr-${item.id}`} value={questionAr} onChange={setQuestionAr} dir="rtl" />
      <div>
        <label className="block text-sm font-medium text-neutral-700">{t("answerLabelAr")}</label>
        <textarea
          value={answerAr}
          onChange={(e) => setAnswerAr(e.target.value)}
          rows={3}
          dir="rtl"
          className="mt-1.5 block w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-neutral-900 focus-visible:border-primary-600 focus-visible:outline-none"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="min-h-9 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </li>
  );
}
