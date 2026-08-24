import React, { useEffect, useMemo, useRef, useState } from "react";
import ArchiveRestore from "lucide-react/dist/esm/icons/archive-restore.js";
import BookOpen from "lucide-react/dist/esm/icons/book-open.js";
import CalendarClock from "lucide-react/dist/esm/icons/calendar-clock.js";
import Check from "lucide-react/dist/esm/icons/check.js";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.js";
import Download from "lucide-react/dist/esm/icons/download.js";
import Edit3 from "lucide-react/dist/esm/icons/edit-3.js";
import Eye from "lucide-react/dist/esm/icons/eye.js";
import Flame from "lucide-react/dist/esm/icons/flame.js";
import Inbox from "lucide-react/dist/esm/icons/inbox.js";
import Library from "lucide-react/dist/esm/icons/library.js";
import Plus from "lucide-react/dist/esm/icons/plus.js";
import Search from "lucide-react/dist/esm/icons/search.js";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.js";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.js";
import Upload from "lucide-react/dist/esm/icons/upload.js";
import Volume2 from "lucide-react/dist/esm/icons/volume-2.js";
import X from "lucide-react/dist/esm/icons/x.js";
import {
  createAutomaticMemoryHook,
  enrichCardsWithAutomaticMemoryHooks,
  MEMORY_REVIEW_THRESHOLD,
} from "./memoryHooks.js";
import {
  compareReviewQueueCards,
  moveCardToReviewQueueEnd,
} from "./reviewQueue.js";

const STORAGE_KEY = "scenecards.data.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const BUNDLED_CONTENT_REVISION = 3;
const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

function normalizeDifficulty(value) {
  const level = (value || "").trim().toUpperCase();
  return CEFR_LEVELS.includes(level) ? level : "";
}

function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const boomerangCard = {
  id: "sample-boomerang",
  expression: "boomerang",
  pronunciation: "/ˈbuː.mə.ræŋ/",
  difficulty: "C2",
  meaning:
    "名词：回旋镖。动词：事情产生反效果，最后反过来影响发起者。",
  originalLine: "His plan could boomerang on him.",
  sceneContext: "一个计划的负面后果反过来伤害制定计划的人。",
  personalExample:
    "The company tried to silence the criticism, but the lawsuit boomeranged and drew even more attention to the story.",
  exampleMeaning:
    "公司本想用诉讼压下批评，结果却适得其反，反而让更多人关注这件事。",
  memoryHook: "扔出去的回旋镖又飞回来：行动的后果也回到自己身上。",
  source: "TV series",
  tags: ["TV series", "verb"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dueAt: new Date().toISOString(),
  intervalDays: 0,
  ease: 2.5,
  repetitions: 0,
  lapses: 0,
  lastReviewedAt: null,
  contentRevision: BUNDLED_CONTENT_REVISION,
};

const exploitCard = {
  id: "research-exploit-thynnine-orchid",
  expression: "exploit",
  pronunciation: "/ɪkˈsplɔɪt/",
  difficulty: "B2",
  meaning:
    "利用某种机制、弱点或机会，使自己获益；这里指性欺骗兰花利用 thynnine 蜂正常的配偶搜索机制完成授粉。",
  originalLine:
    "These results provide an exciting foundation for investigating chemical communication and how sexually deceptive orchids exploit the normal mate-search system of their thynnine wasp pollinators.",
  sceneContext:
    "科研论文语境：兰花借助或操纵传粉蜂正常寻找配偶的系统，达到自身的授粉目的。",
  personalExample:
    "Sexually deceptive orchids exploit a male wasp's search for a mate by imitating the scent of a female.",
  exampleMeaning:
    "性欺骗兰花模仿雌蜂的气味，利用雄蜂寻找配偶的行为来完成授粉。",
  memoryHook:
    "exploit = use something to your own advantage；比 use 更强调借力、占便宜或操纵。",
  source: "Research paper - thynnine wasp pollination",
  tags: ["research", "biology", "verb"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dueAt: new Date().toISOString(),
  intervalDays: 0,
  ease: 2.5,
  repetitions: 0,
  lapses: 0,
  lastReviewedAt: null,
  contentRevision: BUNDLED_CONTENT_REVISION,
};

const bundledCards = [boomerangCard, exploitCard];

const emptyForm = {
  expression: "",
  pronunciation: "",
  difficulty: "",
  meaning: "",
  originalLine: "",
  sceneContext: "",
  personalExample: "",
  exampleMeaning: "",
  memoryHook: "",
  source: "",
  tags: "",
};

function isDraft(card) {
  return card.status === "draft";
}

function looksLikeSentence(value) {
  const text = (value || "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 6 || (words.length >= 3 && /[.!?]["')\]]?$/.test(text));
}

function captureKey(card) {
  const expression = (card.expression || "").trim().replace(/\s+/g, " ").toLowerCase();
  const originalLine = (card.originalLine || "").trim().replace(/\s+/g, " ").toLowerCase();
  return `${expression}\u0000${originalLine}`;
}

function captureExpressionKey(card) {
  return (card.expression || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function captureToCard(capture) {
  const now = capture.createdAt || new Date().toISOString();
  const meaning = (capture.meaning || "").trim();
  return {
    id: `bob-${capture.id}`,
    captureId: capture.id,
    captureIds: [capture.id],
    captureContentRevision: capture.contentRevision || 1,
    status: meaning && !capture.needsEditing ? "active" : "draft",
    expression: capture.expression.trim(),
    pronunciation: capture.pronunciation || "",
    difficulty: normalizeDifficulty(capture.difficulty),
    meaning,
    originalLine: capture.originalLine || "",
    sceneContext: capture.sceneContext || "",
    personalExample: capture.personalExample || "",
    exampleMeaning: capture.exampleMeaning || "",
    memoryHook: capture.memoryHook || "",
    memoryHookSource: capture.memoryHook ? "curated" : undefined,
    source: capture.source || "Bob",
    tags: Array.from(new Set([...(capture.tags || []), "Bob"])),
    needsTarget: Boolean(capture.needsTarget),
    createdAt: now,
    updatedAt: now,
    dueAt: now,
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0,
    lastReviewedAt: null,
  };
}

function reconcileCapturedCards(previous, captures, deletedCaptureIds = new Set()) {
  const removedCardIds = new Set(
    previous.cards
      .filter((card) =>
        deletedCaptureIds.has(card.captureId) ||
        (card.captureIds || []).some((id) => deletedCaptureIds.has(id)),
      )
      .map((card) => card.id),
  );
  const cards = previous.cards.filter((card) => !removedCardIds.has(card.id));
  const previousDismissed = new Set(previous.dismissedCaptureIds || []);
  const dismissed = new Set([...previousDismissed, ...deletedCaptureIds]);
  const processedCaptureRevisions = {
    ...(previous.processedCaptureRevisions || {}),
  };
  let changed = removedCardIds.size > 0 || dismissed.size !== previousDismissed.size;

  for (const capture of captures) {
    const revision = capture.contentRevision || 1;
    if ((processedCaptureRevisions[capture.id] || 0) >= revision) continue;
    processedCaptureRevisions[capture.id] = revision;
    changed = true;
    if (dismissed.has(capture.id)) continue;
    const incoming = captureToCard(capture);
    const existingIndex = cards.findIndex(
      (card) =>
        card.captureId === incoming.captureId ||
        captureKey(card) === captureKey(incoming) ||
        (card.source === "Bob 收藏" &&
          incoming.source === "Bob 收藏" &&
          captureExpressionKey(card) === captureExpressionKey(incoming)),
    );

    if (existingIndex === -1) {
      cards.unshift(incoming);
      continue;
    }

    const existing = cards[existingIndex];
    const captureIds = Array.from(new Set([
      ...(existing.captureIds || []),
      existing.captureId,
      ...incoming.captureIds,
    ].filter(Boolean)));
    const refreshesCapture =
      !existing.userEdited &&
      incoming.captureContentRevision > (existing.captureContentRevision || 0);
    const refreshesMemoryHook =
      Boolean(incoming.memoryHook) &&
      incoming.captureContentRevision > (existing.captureContentRevision || 0) &&
      (!existing.userEdited ||
        existing.memoryHookSource === "automatic" ||
        !(existing.memoryHook || "").trim());
    const enrichment = {
      pronunciation: refreshesCapture
        ? incoming.pronunciation
        : existing.pronunciation || incoming.pronunciation,
      difficulty: existing.difficulty || incoming.difficulty,
      meaning: refreshesCapture ? incoming.meaning : existing.meaning || incoming.meaning,
      originalLine: refreshesCapture
        ? incoming.originalLine
        : existing.originalLine || incoming.originalLine,
      sceneContext: refreshesCapture
        ? incoming.sceneContext
        : existing.sceneContext || incoming.sceneContext,
      personalExample: refreshesCapture
        ? incoming.personalExample
        : existing.personalExample || incoming.personalExample,
      exampleMeaning: refreshesCapture
        ? incoming.exampleMeaning
        : existing.exampleMeaning || incoming.exampleMeaning,
      memoryHook: refreshesMemoryHook
        ? incoming.memoryHook
        : existing.memoryHook || incoming.memoryHook,
      memoryHookSource: refreshesMemoryHook
        ? incoming.memoryHookSource
        : existing.memoryHookSource || incoming.memoryHookSource,
    };
    const addsContext = Object.entries(enrichment).some(
      ([field, value]) => !existing[field] && Boolean(value),
    );
    const activatesDraft = isDraft(existing) && !isDraft(incoming);
    const addsCapture = captureIds.length !== (existing.captureIds || []).length;
    if (
      addsContext ||
      activatesDraft ||
      addsCapture ||
      refreshesCapture ||
      refreshesMemoryHook
    ) {
      cards[existingIndex] = {
        ...existing,
        ...enrichment,
        captureId: incoming.captureId,
        captureIds,
        captureContentRevision: Math.max(
          existing.captureContentRevision || 0,
          incoming.captureContentRevision,
        ),
        status: refreshesCapture
          ? incoming.status
          : activatesDraft
            ? "active"
            : existing.status,
        needsTarget: refreshesCapture ? incoming.needsTarget : existing.needsTarget,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  if (!changed) return previous;
  const nextStore = {
    ...previous,
    cards,
    reviews: (previous.reviews || []).filter(
      (review) => !removedCardIds.has(review.cardId),
    ),
    dismissedCaptureIds: [...dismissed],
    processedCaptureRevisions,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore));
  return nextStore;
}

function migrateCard(card) {
  let migrated = {
    ...card,
    difficulty: normalizeDifficulty(card.difficulty),
    exampleMeaning: card.exampleMeaning || "",
    captureIds: Array.from(new Set([
      ...(card.captureIds || []),
      card.captureId,
    ].filter(Boolean))),
  };

  if (
    migrated.source === "Bob 收藏" &&
    isDraft(migrated) &&
    looksLikeSentence(migrated.expression)
  ) {
    migrated = {
      ...migrated,
      needsTarget: true,
      originalLine: migrated.originalLine || migrated.expression,
      sceneContext: migrated.sceneContext || migrated.meaning || "",
      meaning: "",
      personalExample: "",
      exampleMeaning: "",
    };
  }

  if (
    migrated.source === "Bob 收藏" &&
    !migrated.personalExample &&
    !migrated.exampleMeaning &&
    migrated.originalLine &&
    /^例句含义：/.test(migrated.sceneContext || "")
  ) {
    migrated = {
      ...migrated,
      personalExample: migrated.originalLine,
      exampleMeaning: migrated.sceneContext.replace(/^例句含义：\s*/, ""),
      originalLine: "",
      sceneContext: "",
    };
  }

  if (/^把 .+ 和这句例句一起回忆，不要只背一个中文释义。$/.test(migrated.memoryHook || "")) {
    migrated.memoryHook = "";
  }

  const bundled = bundledCards.find((candidate) => candidate.id === migrated.id);
  if (bundled && (migrated.contentRevision || 0) < BUNDLED_CONTENT_REVISION) {
    migrated = {
      ...migrated,
      originalLine: bundled.originalLine,
      sceneContext: bundled.sceneContext,
      personalExample: bundled.personalExample,
      exampleMeaning: bundled.exampleMeaning,
      memoryHook: bundled.memoryHook,
      difficulty: bundled.difficulty,
      contentRevision: BUNDLED_CONTENT_REVISION,
    };
  }

  return migrated;
}

function mergeBundledCards(data) {
  const cards = Array.isArray(data.cards) ? data.cards.map(migrateCard) : [];
  const reviews = Array.isArray(data.reviews) ? data.reviews : [];
  const bundledIds = new Set(bundledCards.map((card) => card.id));
  const installedSeeds = new Set(
    Array.isArray(data.installedSeeds)
      ? data.installedSeeds
      : cards
          .filter((card) => bundledIds.has(card.id))
          .map((card) => card.id),
  );
  const existingExpressions = new Set(
    cards.map((card) => card.expression?.trim().toLowerCase()).filter(Boolean),
  );
  const additions = bundledCards.filter(
    (card) =>
      !installedSeeds.has(card.id) &&
      !existingExpressions.has(card.expression.toLowerCase()),
  );

  return {
    cards: enrichCardsWithAutomaticMemoryHooks([...additions, ...cards], reviews),
    reviews,
    installedSeeds: [...bundledIds],
    dismissedCaptureIds: Array.isArray(data.dismissedCaptureIds)
      ? data.dismissedCaptureIds
      : [],
    processedCaptureRevisions:
      data.processedCaptureRevisions && typeof data.processedCaptureRevisions === "object"
        ? data.processedCaptureRevisions
        : {},
  };
}

function createCloze(sentence, expression) {
  const source = (sentence || "").trim();
  const target = (expression || "").trim();
  if (!source || !target) return null;

  const targets = [target];
  if (!/\s/.test(target) && target.length > 3 && /s$/i.test(target)) {
    targets.push(target.slice(0, -1));
  }
  const lowerSource = source.toLocaleLowerCase();
  let matchedTarget = "";
  let index = -1;
  for (const candidate of targets) {
    const candidateIndex = lowerSource.indexOf(candidate.toLocaleLowerCase());
    if (candidateIndex < 0) continue;
    const before = source[candidateIndex - 1] || "";
    const after = source[candidateIndex + candidate.length] || "";
    if (!/[A-Za-z'-]/.test(before) && !/[A-Za-z'-]/.test(after)) {
      matchedTarget = candidate;
      index = candidateIndex;
      break;
    }
  }
  if (!matchedTarget) return null;

  let start = index;
  let end = index + matchedTarget.length;
  if (!/\s/.test(matchedTarget)) {
    while (start > 0 && /[A-Za-z'-]/.test(source[start - 1])) start -= 1;
    while (end < source.length && /[A-Za-z'-]/.test(source[end])) end += 1;
  }

  return {
    before: source.slice(0, start),
    answer: source.slice(start, end),
    after: source.slice(end),
  };
}

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.cards)) {
      return mergeBundledCards(saved);
    }
  } catch {
    // A damaged local backup should not prevent the app from opening.
  }
  return mergeBundledCards({ cards: [], reviews: [], installedSeeds: [] });
}

function localDateKey(value = new Date()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hasLocalMacBridge() {
  const { hostname, protocol } = window.location;
  if (protocol !== "http:") return false;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local") ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function formatDue(value) {
  const due = new Date(value);
  const now = new Date();
  if (due <= now) return "现在";
  if (localDateKey(due) === localDateKey(now)) {
    return due.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return due.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function calculateStreak(reviews) {
  const activeDays = new Set(reviews.map((review) => localDateKey(review.at)));
  let cursor = new Date();
  if (!activeDays.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (activeDays.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function scheduleCard(card, rating) {
  const now = new Date();
  let repetitions = card.repetitions || 0;
  let intervalDays = card.intervalDays || 0;
  let ease = card.ease || 2.5;
  let lapses = card.lapses || 0;
  let dueAt;

  if (rating === "again") {
    repetitions = 0;
    intervalDays = 0;
    ease = Math.max(1.3, ease - 0.2);
    lapses += 1;
    dueAt = now;
  } else if (rating === "good") {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 3;
    else intervalDays = Math.max(4, Math.round(intervalDays * ease));
    dueAt = new Date(now.getTime() + intervalDays * DAY_MS);
  } else {
    repetitions += 1;
    ease = Math.min(3.2, ease + 0.15);
    intervalDays = repetitions === 1
      ? 4
      : Math.max(7, Math.round((intervalDays || 3) * ease * 1.25));
    dueAt = new Date(now.getTime() + intervalDays * DAY_MS);
  }

  return {
    ...card,
    repetitions,
    intervalDays,
    ease,
    lapses,
    dueAt: dueAt.toISOString(),
    lastReviewedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function IconButton({ label, children, className = "", ...props }) {
  return (
    <button
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function DifficultyBadge({ level }) {
  const difficulty = normalizeDifficulty(level);
  return (
    <span className={`difficulty-badge ${difficulty ? `level-${difficulty.toLowerCase()}` : "ungraded"}`}>
      {difficulty || "未分级"}
    </span>
  );
}

function App() {
  const [store, setStore] = useState(loadStore);
  const [view, setView] = useState("review");
  const [revealed, setRevealed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const importRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let disposed = false;
    let syncing = false;

    async function syncPublishedCards() {
      if (!navigator.onLine || syncing) return;
      syncing = true;
      try {
        const libraryUrl = `${import.meta.env.BASE_URL}data/cards.json`;
        const response = await fetch(libraryUrl, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const captures = Array.isArray(payload.cards) ? payload.cards : [];
        if (!captures.length || disposed) return;
        setStore((previous) => reconcileCapturedCards(previous, captures));
      } catch {
        // Keep the installed app usable offline with its last local copy.
      } finally {
        syncing = false;
      }
    }

    syncPublishedCards();
    window.addEventListener("focus", syncPublishedCards);
    window.addEventListener("online", syncPublishedCards);
    return () => {
      disposed = true;
      window.removeEventListener("focus", syncPublishedCards);
      window.removeEventListener("online", syncPublishedCards);
    };
  }, []);

  useEffect(() => {
    if (!hasLocalMacBridge()) return undefined;

    let disposed = false;
    let syncing = false;

    async function syncBobInbox() {
      if (!navigator.onLine || syncing) return;
      syncing = true;
      try {
        const response = await fetch("/api/inbox?schema=3", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const captures = Array.isArray(payload.cards) ? payload.cards : [];
        const deletedCaptureIds = new Set(
          Array.isArray(payload.deletedCaptureIds) ? payload.deletedCaptureIds : [],
        );
        if ((!captures.length && !deletedCaptureIds.size) || disposed) return;

        setStore((previous) =>
          reconcileCapturedCards(previous, captures, deletedCaptureIds),
        );

        await fetch("/api/inbox/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: captures.map((capture) => capture.id) }),
        });
      } catch {
        // The app remains fully usable when its optional Bob bridge is offline.
      } finally {
        syncing = false;
      }
    }

    syncBobInbox();
    const interval = window.setInterval(syncBobInbox, 5_000);
    window.addEventListener("focus", syncBobInbox);
    window.addEventListener("online", syncBobInbox);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", syncBobInbox);
      window.removeEventListener("online", syncBobInbox);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const activeCards = useMemo(
    () => store.cards.filter((card) => !isDraft(card)),
    [store.cards],
  );
  const draftCards = useMemo(
    () => store.cards.filter(isDraft),
    [store.cards],
  );

  const dueCards = useMemo(
    () =>
      [...activeCards]
        .filter((card) => new Date(card.dueAt).getTime() <= now)
        .sort(compareReviewQueueCards),
    [activeCards, now],
  );

  const currentCard = dueCards[0] || null;
  const matureCount = activeCards.filter((card) => card.intervalDays >= 21).length;
  const streak = calculateStreak(store.reviews);
  const nextCard = [...activeCards]
    .filter((card) => new Date(card.dueAt).getTime() > now)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];

  const visibleCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...activeCards]
      .filter((card) => {
        if (filter === "due" && new Date(card.dueAt).getTime() > now) return false;
        if (filter === "learning" && card.intervalDays >= 21) return false;
        if (filter === "mature" && card.intervalDays < 21) return false;
        if (!needle) return true;
        return [
          card.expression,
          card.difficulty,
          card.meaning,
          card.originalLine,
          card.personalExample,
          card.exampleMeaning,
          card.source,
          ...(card.tags || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => a.expression.localeCompare(b.expression));
  }, [activeCards, filter, now, query]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (modalOpen || view !== "review" || !currentCard) return;
      if (event.code === "Space") {
        event.preventDefault();
        revealAnswer();
      }
      if (revealed && ["1", "2", "3"].includes(event.key)) {
        const ratings = { 1: "again", 2: "good", 3: "easy" };
        rateCard(ratings[event.key]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function speak(text) {
    const value = (text || "").trim();
    if (!value) return;

    window.speechSynthesis?.cancel();
    audioRef.current?.pause();

    let voiceStarted = false;
    const useDeviceVoice = () => {
      if (voiceStarted) return;
      voiceStarted = true;
      if (!("speechSynthesis" in window)) {
        setToast("无法播放语音，请检查设备的声音设置");
        return;
      }

      const utterance = new SpeechSynthesisUtterance(value);
      const voices = window.speechSynthesis.getVoices();
      utterance.voice =
        voices.find((voice) => voice.lang === "en-GB") ||
        voices.find((voice) => voice.lang.startsWith("en")) ||
        null;
      utterance.lang = utterance.voice?.lang || "en-GB";
      utterance.rate = 0.88;
      utterance.onerror = () => setToast("无法播放语音，请检查设备的声音设置");
      window.speechSynthesis.speak(utterance);
    };

    if (!hasLocalMacBridge()) {
      useDeviceVoice();
      return;
    }

    const audio = new Audio(`/api/speech?text=${encodeURIComponent(value)}`);
    audioRef.current = audio;

    const useBrowserVoice = () => {
      if (audioRef.current === audio) audioRef.current = null;
      useDeviceVoice();
    };

    audio.addEventListener("error", useBrowserVoice, { once: true });
    audio.addEventListener("ended", () => {
      if (audioRef.current === audio) audioRef.current = null;
    }, { once: true });
    audio.play().catch(useBrowserVoice);
  }

  function revealAnswer() {
    if (revealed || !currentCard) return;
    setRevealed(true);
    speak(currentCard.expression);
  }

  function rateCard(rating) {
    if (!currentCard) return;
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    let reviewed = scheduleCard(currentCard, rating);
    if (rating === "again") {
      reviewed = moveCardToReviewQueueEnd(reviewed, dueCards, now);
    } else {
      reviewed = { ...reviewed, reviewQueueOrder: undefined };
    }
    const review = {
      id: createId(),
      cardId: currentCard.id,
      rating,
      at: new Date().toISOString(),
    };
    const reviewCount =
      store.reviews.filter((item) => item.cardId === currentCard.id).length + 1;
    const automaticMemoryHook =
      reviewCount >= MEMORY_REVIEW_THRESHOLD && !(reviewed.memoryHook || "").trim()
        ? createAutomaticMemoryHook(reviewed)
        : "";
    const reviewedCard = automaticMemoryHook
      ? {
          ...reviewed,
          memoryHook: automaticMemoryHook,
          memoryHookSource: "automatic",
          memoryHookReviewCount: reviewCount,
        }
      : reviewed;
    setStore((previous) => ({
      ...previous,
      cards: previous.cards.map((card) =>
        card.id === currentCard.id ? reviewedCard : card,
      ),
      reviews: [...previous.reviews, review],
    }));
    setRevealed(false);
    const reviewMessage =
      rating === "again"
        ? "已加入本轮复习队列末尾"
        : `下次复习：${formatDue(reviewed.dueAt)}`;
    setToast(
      automaticMemoryHook
        ? `已增加联想记忆；${reviewMessage}`
        : reviewMessage,
    );
  }

  function openNewCard() {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEditCard(card) {
    const choosingTarget = Boolean(card.needsTarget);
    setEditingId(card.id);
    setForm({
      expression: choosingTarget ? "" : card.expression,
      pronunciation: card.pronunciation || "",
      difficulty: normalizeDifficulty(card.difficulty),
      meaning: choosingTarget ? "" : card.meaning,
      originalLine: card.originalLine || (choosingTarget ? card.expression : ""),
      sceneContext: card.sceneContext || (choosingTarget ? card.meaning : "") || "",
      personalExample: card.personalExample || "",
      exampleMeaning: card.exampleMeaning || "",
      memoryHook: card.memoryHook || "",
      source: card.source || "",
      tags: (card.tags || []).join(", "),
    });
    setModalOpen(true);
  }

  function saveCard(event) {
    event.preventDefault();
    const now = new Date().toISOString();
    const values = {
      ...form,
      expression: form.expression.trim(),
      difficulty: normalizeDifficulty(form.difficulty),
      meaning: form.meaning.trim(),
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      updatedAt: now,
      memoryHookSource: form.memoryHook.trim() ? "manual" : undefined,
    };
    if (!values.expression || !values.meaning) return;
    if (!values.personalExample.trim() || !values.exampleMeaning.trim()) {
      setToast("请先补全代表性例句和整句中文意思");
      return;
    }

    if (editingId) {
      const wasDraft = store.cards.some(
        (card) => card.id === editingId && isDraft(card),
      );
      setStore((previous) => ({
        ...previous,
        cards: previous.cards.map((card) =>
          card.id === editingId
            ? {
                ...card,
                ...values,
                status: "active",
                needsTarget: false,
                userEdited: true,
              }
            : card,
        ),
      }));
      if (wasDraft) {
        setView("review");
        setToast("已整理并加入今天的复习");
      } else {
        setToast("卡片已更新");
      }
    } else {
      const card = {
        ...values,
        id: createId(),
        status: "active",
        createdAt: now,
        dueAt: now,
        intervalDays: 0,
        ease: 2.5,
        repetitions: 0,
        lapses: 0,
        lastReviewedAt: null,
      };
      setStore((previous) => ({
        ...previous,
        cards: [card, ...previous.cards],
      }));
      setView("review");
      setToast("新卡片已加入今天的复习");
    }
    setModalOpen(false);
    setRevealed(false);
  }

  function deleteCard(card) {
    const confirmed = window.confirm(`删除“${card.expression}”？此操作无法撤销。`);
    if (!confirmed) return;
    setStore((previous) => {
      const captureIds = [
        ...(card.captureIds || []),
        card.captureId,
      ].filter(Boolean);
      return {
        ...previous,
        cards: previous.cards.filter((item) => item.id !== card.id),
        reviews: previous.reviews.filter((review) => review.cardId !== card.id),
        dismissedCaptureIds: Array.from(new Set([
          ...(previous.dismissedCaptureIds || []),
          ...captureIds,
        ])),
      };
    });
    setToast("卡片已删除");
  }

  function exportData() {
    const payload = {
      app: "SceneCards",
      version: 1,
      exportedAt: new Date().toISOString(),
      ...store,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `scenecards-${localDateKey()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("备份已下载");
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.cards)) throw new Error("Invalid backup");
        const confirmed = window.confirm(
          `导入 ${data.cards.length} 张卡片并替换当前内容？`,
        );
        if (confirmed) {
          setStore(mergeBundledCards(data));
          setRevealed(false);
          setToast("备份已恢复");
        }
      } catch {
        setToast("无法读取这个备份文件");
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen size={21} strokeWidth={2.2} />
          </span>
          <div>
            <strong>SceneCards</strong>
            <span>情境英语闪卡</span>
          </div>
        </div>

        <div className="header-actions">
          <IconButton label="导入备份" onClick={() => importRef.current?.click()}>
            <Upload size={19} />
          </IconButton>
          <input
            ref={importRef}
            hidden
            type="file"
            accept="application/json"
            onChange={importData}
          />
          <IconButton label="下载备份" onClick={exportData}>
            <Download size={19} />
          </IconButton>
          <button
            className="primary-button compact"
            type="button"
            aria-label="添加卡片"
            title="添加卡片"
            onClick={openNewCard}
          >
            <Plus size={18} />
            <span>添加卡片</span>
          </button>
        </div>
      </header>

      <nav className="view-tabs" aria-label="主要页面">
        <button
          className={view === "review" ? "active" : ""}
          type="button"
          onClick={() => setView("review")}
        >
          <Sparkles size={18} />
          今日复习
          {dueCards.length > 0 && <span className="count-badge">{dueCards.length}</span>}
        </button>
        <button
          className={view === "library" ? "active" : ""}
          type="button"
          onClick={() => setView("library")}
        >
          <Library size={18} />
          全部卡片
        </button>
        <button
          className={view === "inbox" ? "active" : ""}
          type="button"
          onClick={() => setView("inbox")}
        >
          <Inbox size={18} />
          Bob 收件箱
          {draftCards.length > 0 && <span className="count-badge">{draftCards.length}</span>}
        </button>
      </nav>

      <main>
        <section className="stats-strip" aria-label="学习概况">
          <div>
            <span className="stat-icon coral"><CalendarClock size={18} /></span>
            <p><strong>{dueCards.length}</strong><span>今日待复习</span></p>
          </div>
          <div>
            <span className="stat-icon teal"><Check size={18} /></span>
            <p><strong>{matureCount}</strong><span>长期记住</span></p>
          </div>
          <div>
            <span className="stat-icon gold"><Flame size={18} /></span>
            <p><strong>{streak}</strong><span>连续天数</span></p>
          </div>
          <div>
            <span className="stat-icon ink"><BookOpen size={18} /></span>
            <p><strong>{activeCards.length}</strong><span>全部表达</span></p>
          </div>
        </section>

        {view === "review" ? (
          <ReviewView
            currentCard={currentCard}
            dueCards={dueCards}
            nextCard={nextCard}
            revealed={revealed}
            onReveal={revealAnswer}
            onRate={rateCard}
            onSpeak={speak}
            onAdd={openNewCard}
          />
        ) : view === "library" ? (
          <LibraryView
            cards={visibleCards}
            query={query}
            filter={filter}
            onQuery={setQuery}
            onFilter={setFilter}
            onEdit={openEditCard}
            onDelete={deleteCard}
            onSpeak={speak}
            onAdd={openNewCard}
          />
        ) : (
          <InboxView
            cards={draftCards}
            onEdit={openEditCard}
            onDelete={deleteCard}
          />
        )}
      </main>

      {modalOpen && (
        <CardModal
          form={form}
          editing={Boolean(editingId)}
          onChange={setForm}
          onClose={() => setModalOpen(false)}
          onSave={saveCard}
        />
      )}

      <div className={`toast ${toast ? "visible" : ""}`} aria-live="polite">
        {toast}
      </div>
    </div>
  );
}

function InboxView({ cards, onEdit, onDelete }) {
  return (
    <section className="inbox-view">
      <div className="inbox-header">
        <div><span>BOB INBOX</span><h1>待整理</h1></div>
        <span>{cards.length} 张</span>
      </div>

      {cards.length ? (
        <div className="inbox-list">
          {cards.map((card) => (
            <article className="inbox-row" key={card.id}>
              <div className="inbox-copy">
                <div>
                  <h2>{card.needsTarget ? "请选择要记的单词" : card.expression}</h2>
                  <div className="word-meta">
                    <span>{card.source || "Bob"}</span>
                    <DifficultyBadge level={card.difficulty} />
                  </div>
                </div>
                {card.originalLine && <p>{card.originalLine}</p>}
                {card.needsTarget && (
                  <small>完整句子已经保留。选择目标单词后，再补充这个单词在句中的意思。</small>
                )}
              </div>
              <div className="row-actions">
                <button className="primary-button" type="button" onClick={() => onEdit(card)}>
                  <Edit3 size={17} />{card.needsTarget ? "选择单词" : "补充含义"}
                </button>
                <IconButton label={`删除 ${card.expression}`} className="danger" onClick={() => onDelete(card)}>
                  <Trash2 size={17} />
                </IconButton>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-library">
          <Inbox size={28} />
          <p>Bob 收件箱是空的。</p>
        </div>
      )}
    </section>
  );
}

function ReviewView({
  currentCard,
  dueCards,
  nextCard,
  revealed,
  onReveal,
  onRate,
  onSpeak,
  onAdd,
}) {
  if (!currentCard) {
    return (
      <section className="empty-review">
        <span className="empty-icon"><Check size={30} /></span>
        <h1>今天的卡片完成了</h1>
        <p>{nextCard ? `下一张将在 ${formatDue(nextCard.dueAt)} 出现。` : "还没有卡片。"}</p>
        <button className="primary-button" type="button" onClick={onAdd}>
          <Plus size={18} />添加卡片
        </button>
      </section>
    );
  }

  const cloze = createCloze(currentCard.personalExample, currentCard.expression);

  return (
    <div className="review-layout">
      <section className={`study-card ${revealed ? "revealed" : ""}`}>
        <div className="card-kicker">
          <div className="word-meta">
            <span>{currentCard.source || "Daily life"}</span>
            <DifficultyBadge level={currentCard.difficulty} />
          </div>
          <span>{dueCards.length} 张待复习</span>
        </div>

        {!revealed && cloze ? (
          <div className="recall-heading">
            <span>CONTEXT RECALL</span>
            <h1>哪一个英语表达适合这里？</h1>
          </div>
        ) : (
          <div className="expression-row">
            <div>
              <h1>{currentCard.expression}</h1>
              {currentCard.pronunciation && <p>{currentCard.pronunciation}</p>}
            </div>
            <IconButton
              label={`朗读 ${currentCard.expression}`}
              className="speak-button"
              onClick={() => onSpeak(currentCard.expression)}
            >
              <Volume2 size={21} />
            </IconButton>
          </div>
        )}

        {cloze ? (
          <>
            <blockquote className="recall-sentence">
              {revealed ? (
                currentCard.personalExample
              ) : (
                <>
                  {cloze.before}<span className="cloze-blank" aria-label="空格" />{cloze.after}
                </>
              )}
            </blockquote>
            {currentCard.exampleMeaning && (
              <p className="recall-meaning">{currentCard.exampleMeaning}</p>
            )}
          </>
        ) : (
          <blockquote>{currentCard.originalLine || "在脑中回想你遇见它的场景。"}</blockquote>
        )}

        {!revealed ? (
          <div className="recall-panel">
            <p>{cloze ? "先在脑中说出完整句子，再看答案。" : "这一幕里，它是什么意思？"}</p>
            <button className="reveal-button" type="button" onClick={onReveal}>
              <Eye size={19} />显示答案
            </button>
          </div>
        ) : (
          <div className="answer-panel">
            <div className="answer-block meaning-block">
              <span>这个表达</span>
              <p>{currentCard.meaning}</p>
            </div>
            {currentCard.originalLine && (
              <div className="answer-block">
                <span>最初遇见它的句子</span>
                <p className="source-sentence">{currentCard.originalLine}</p>
              </div>
            )}
            {currentCard.sceneContext && (
              <div className="answer-block">
                <span>原句中的意思</span>
                <p>{currentCard.sceneContext}</p>
              </div>
            )}
            {cloze && (
              <div className="example-actions">
                <span>把完整例句读一遍，注意这个表达为什么正好适合这里。</span>
                <IconButton label="朗读完整例句" onClick={() => onSpeak(currentCard.personalExample)}>
                  <Volume2 size={18} />
                </IconButton>
              </div>
            )}
            {!cloze && currentCard.personalExample && (
              <div className="answer-block example-block">
                <span>代表性例句</span>
                <div>
                  <p>{currentCard.personalExample}</p>
                  {currentCard.exampleMeaning && <small>{currentCard.exampleMeaning}</small>}
                </div>
                <IconButton label="朗读例句" onClick={() => onSpeak(currentCard.personalExample)}>
                  <Volume2 size={18} />
                </IconButton>
              </div>
            )}
            {currentCard.memoryHook && (
              <div className="memory-hook">
                <Sparkles size={17} />
                <p>{currentCard.memoryHook}</p>
              </div>
            )}
          </div>
        )}

        <div className={`rating-row ${revealed ? "visible" : ""}`}>
          <button className="rating again" type="button" onClick={() => onRate("again")}>
            <strong>忘了</strong><span>队尾再练</span>
          </button>
          <button className="rating good" type="button" onClick={() => onRate("good")}>
            <strong>记得</strong><span>按进度</span>
          </button>
          <button className="rating easy" type="button" onClick={() => onRate("easy")}>
            <strong>很熟</strong><span>延长间隔</span>
          </button>
        </div>
      </section>

      <aside className="review-queue">
        <div className="section-heading">
          <div>
            <span>QUEUE</span>
            <h2>今天的队列</h2>
          </div>
          <span className="queue-total">{dueCards.length}</span>
        </div>
        <div className="queue-list">
          {dueCards.slice(0, 6).map((card, index) => (
            <div className={index === 0 ? "queue-item current" : "queue-item"} key={card.id}>
              <span className="queue-number">{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{card.expression}</strong><span>{card.source || "Daily life"}</span></div>
              {index === 0 && <ChevronRight size={17} />}
            </div>
          ))}
        </div>
        {dueCards.length > 6 && <p className="queue-more">另外 {dueCards.length - 6} 张</p>}
      </aside>
    </div>
  );
}

function LibraryView({
  cards,
  query,
  filter,
  onQuery,
  onFilter,
  onEdit,
  onDelete,
  onSpeak,
  onAdd,
}) {
  return (
    <section className="library-view">
      <div className="library-toolbar">
        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="搜索表达、含义或来源"
          />
        </label>
        <div className="segmented-control" aria-label="筛选卡片">
          {[
            ["all", "全部"],
            ["due", "待复习"],
            ["learning", "学习中"],
            ["mature", "已掌握"],
          ].map(([value, label]) => (
            <button
              className={filter === value ? "active" : ""}
              type="button"
              key={value}
              onClick={() => onFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="library-header">
        <div><span>LIBRARY</span><h1>全部表达</h1></div>
        <span>{cards.length} 张</span>
      </div>

      {cards.length ? (
        <div className="card-list">
          {cards.map((card) => (
            <article className="library-row" key={card.id}>
              <div className="word-cell">
                <div>
                  <h2>{card.expression}</h2>
                  <div className="word-meta">
                    <span>{card.pronunciation}</span>
                    <DifficultyBadge level={card.difficulty} />
                  </div>
                </div>
                <IconButton label={`朗读 ${card.expression}`} onClick={() => onSpeak(card.expression)}>
                  <Volume2 size={18} />
                </IconButton>
              </div>
              <div className="meaning-cell">
                <p>{card.meaning}</p>
                <span>{card.personalExample || card.originalLine}</span>
              </div>
              <div className="status-cell">
                <span className={new Date(card.dueAt).getTime() <= Date.now() ? "due-pill" : "date-pill"}>
                  {new Date(card.dueAt).getTime() <= Date.now() ? "待复习" : formatDue(card.dueAt)}
                </span>
              </div>
              <div className="row-actions">
                <IconButton label={`编辑 ${card.expression}`} onClick={() => onEdit(card)}>
                  <Edit3 size={17} />
                </IconButton>
                <IconButton label={`删除 ${card.expression}`} className="danger" onClick={() => onDelete(card)}>
                  <Trash2 size={17} />
                </IconButton>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-library">
          <ArchiveRestore size={28} />
          <p>这里暂时没有符合条件的卡片。</p>
          <button className="text-button" type="button" onClick={onAdd}>添加一张</button>
        </div>
      )}
    </section>
  );
}

function CardModal({ form, editing, onChange, onClose, onSave }) {
  function update(field, value) {
    onChange((previous) => ({ ...previous, [field]: value }));
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="card-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span>{editing ? "EDIT CARD" : "NEW CARD"}</span>
            <h2 id="card-modal-title">{editing ? "编辑卡片" : "添加情境卡片"}</h2>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={20} /></IconButton>
        </div>

        <form onSubmit={onSave}>
          <div className="form-grid card-basics">
            <label>
              <span>英语表达 *</span>
              <input
                autoFocus={!editing || !form.expression || Boolean(form.meaning)}
                required
                value={form.expression}
                onChange={(event) => update("expression", event.target.value)}
                placeholder="boomerang"
              />
            </label>
            <label>
              <span>发音</span>
              <input
                value={form.pronunciation}
                onChange={(event) => update("pronunciation", event.target.value)}
                placeholder="/ˈbuː.mə.ræŋ/"
              />
            </label>
            <label>
              <span>单词难度</span>
              <select
                value={form.difficulty}
                onChange={(event) => update("difficulty", event.target.value)}
              >
                <option value="">未分级</option>
                <option value="A1">A1 · 入门</option>
                <option value="A2">A2 · 基础</option>
                <option value="B1">B1 · 中级</option>
                <option value="B2">B2 · 中高级</option>
                <option value="C1">C1 · 高级</option>
                <option value="C2">C2 · 精通</option>
              </select>
            </label>
          </div>

          <label>
            <span>这一幕里的含义 *</span>
            <textarea
              autoFocus={editing && Boolean(form.expression) && !form.meaning}
              required
              value={form.meaning}
              onChange={(event) => update("meaning", event.target.value)}
              placeholder="不要只写词典释义，写清它在这里表达什么"
            />
          </label>

          <label>
            <span>剧中原句</span>
            <textarea
              value={form.originalLine}
              onChange={(event) => update("originalLine", event.target.value)}
              placeholder="His plan could boomerang on him."
            />
          </label>

          <label>
            <span>场景</span>
            <textarea
              value={form.sceneContext}
              onChange={(event) => update("sceneContext", event.target.value)}
              placeholder="当时发生了什么？说话的人为什么这样表达？"
            />
          </label>

          <label>
            <span>代表性例句 *</span>
            <textarea
              required
              value={form.personalExample}
              onChange={(event) => update("personalExample", event.target.value)}
              placeholder="写一个具体、有后果的场景，并让这个表达不可替代"
            />
          </label>

          <label>
            <span>代表性例句的意思 *</span>
            <textarea
              required
              value={form.exampleMeaning}
              onChange={(event) => update("exampleMeaning", event.target.value)}
              placeholder="自然地翻译整句话，不要只重复单词释义"
            />
          </label>

          <label>
            <span>记忆线索</span>
            <textarea
              value={form.memoryHook}
              onChange={(event) => update("memoryHook", event.target.value)}
              placeholder="一个画面、对比或简短联想"
            />
          </label>

          <div className="form-grid two-columns">
            <label>
              <span>来源</span>
              <input
                value={form.source}
                onChange={(event) => update("source", event.target.value)}
                placeholder="剧名、集数或生活场景"
              />
            </label>
            <label>
              <span>标签</span>
              <input
                value={form.tags}
                onChange={(event) => update("tags", event.target.value)}
                placeholder="TV series, verb"
              />
            </label>
          </div>

          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>取消</button>
            <button className="primary-button" type="submit">
              <Check size={18} />{editing ? "保存修改" : "加入复习"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default App;
