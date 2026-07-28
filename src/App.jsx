import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArchiveRestore,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  Flame,
  Library,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";

const STORAGE_KEY = "scenecards.data.v1";
const DAY_MS = 24 * 60 * 60 * 1000;

const sampleCard = {
  id: "sample-boomerang",
  expression: "boomerang",
  pronunciation: "/ˈbuː.mə.ræŋ/",
  meaning:
    "名词：回旋镖。动词：事情产生反效果，最后反过来影响发起者。",
  originalLine: "His plan could boomerang on him.",
  sceneContext: "一个计划的负面后果反过来伤害制定计划的人。",
  personalExample: "If we push too hard, the plan may boomerang on us.",
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
};

const emptyForm = {
  expression: "",
  pronunciation: "",
  meaning: "",
  originalLine: "",
  sceneContext: "",
  personalExample: "",
  memoryHook: "",
  source: "",
  tags: "",
};

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.cards)) {
      return { cards: saved.cards, reviews: saved.reviews || [] };
    }
  } catch {
    // A damaged local backup should not prevent the app from opening.
  }
  return { cards: [sampleCard], reviews: [] };
}

function localDateKey(value = new Date()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
    dueAt = new Date(now.getTime() + 10 * 60 * 1000);
  } else if (rating === "hard") {
    repetitions += 1;
    intervalDays = Math.max(1, Math.round((intervalDays || 1) * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    dueAt = new Date(now.getTime() + intervalDays * DAY_MS);
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const dueCards = useMemo(
    () =>
      [...store.cards]
        .filter((card) => new Date(card.dueAt).getTime() <= now)
        .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)),
    [now, store.cards],
  );

  const currentCard = dueCards[0] || null;
  const matureCount = store.cards.filter((card) => card.intervalDays >= 21).length;
  const streak = calculateStreak(store.reviews);
  const nextCard = [...store.cards]
    .filter((card) => new Date(card.dueAt).getTime() > now)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];

  const visibleCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...store.cards]
      .filter((card) => {
        if (filter === "due" && new Date(card.dueAt).getTime() > now) return false;
        if (filter === "learning" && card.intervalDays >= 21) return false;
        if (filter === "mature" && card.intervalDays < 21) return false;
        if (!needle) return true;
        return [
          card.expression,
          card.meaning,
          card.originalLine,
          card.source,
          ...(card.tags || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => a.expression.localeCompare(b.expression));
  }, [filter, now, query, store.cards]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (modalOpen || view !== "review" || !currentCard) return;
      if (event.code === "Space") {
        event.preventDefault();
        setRevealed(true);
      }
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
        const ratings = { 1: "again", 2: "hard", 3: "good", 4: "easy" };
        rateCard(ratings[event.key]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function speak(text) {
    if (!("speechSynthesis" in window)) {
      setToast("当前浏览器不支持语音播放");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice =
      voices.find((voice) => voice.lang === "en-GB") ||
      voices.find((voice) => voice.lang.startsWith("en")) ||
      null;
    utterance.lang = utterance.voice?.lang || "en-GB";
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
  }

  function rateCard(rating) {
    if (!currentCard) return;
    const reviewed = scheduleCard(currentCard, rating);
    const review = {
      id: crypto.randomUUID(),
      cardId: currentCard.id,
      rating,
      at: new Date().toISOString(),
    };
    setStore((previous) => ({
      cards: previous.cards.map((card) =>
        card.id === currentCard.id ? reviewed : card,
      ),
      reviews: [...previous.reviews, review],
    }));
    setRevealed(false);
    setToast(`下次复习：${formatDue(reviewed.dueAt)}`);
  }

  function openNewCard() {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEditCard(card) {
    setEditingId(card.id);
    setForm({
      expression: card.expression,
      pronunciation: card.pronunciation || "",
      meaning: card.meaning,
      originalLine: card.originalLine || "",
      sceneContext: card.sceneContext || "",
      personalExample: card.personalExample || "",
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
      meaning: form.meaning.trim(),
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      updatedAt: now,
    };
    if (!values.expression || !values.meaning) return;

    if (editingId) {
      setStore((previous) => ({
        ...previous,
        cards: previous.cards.map((card) =>
          card.id === editingId ? { ...card, ...values } : card,
        ),
      }));
      setToast("卡片已更新");
    } else {
      const card = {
        ...values,
        id: crypto.randomUUID(),
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
    setStore((previous) => ({
      cards: previous.cards.filter((item) => item.id !== card.id),
      reviews: previous.reviews.filter((review) => review.cardId !== card.id),
    }));
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
          setStore({ cards: data.cards, reviews: data.reviews || [] });
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
            <p><strong>{store.cards.length}</strong><span>全部表达</span></p>
          </div>
        </section>

        {view === "review" ? (
          <ReviewView
            currentCard={currentCard}
            dueCards={dueCards}
            nextCard={nextCard}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            onRate={rateCard}
            onSpeak={speak}
            onAdd={openNewCard}
          />
        ) : (
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

  return (
    <div className="review-layout">
      <section className={`study-card ${revealed ? "revealed" : ""}`}>
        <div className="card-kicker">
          <span>{currentCard.source || "Daily life"}</span>
          <span>{dueCards.length} 张待复习</span>
        </div>

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

        <blockquote>{currentCard.originalLine || "在脑中回想你遇见它的场景。"}</blockquote>

        {!revealed ? (
          <div className="recall-panel">
            <p>这一幕里，它是什么意思？</p>
            <button className="reveal-button" type="button" onClick={onReveal}>
              <Eye size={19} />显示含义
            </button>
          </div>
        ) : (
          <div className="answer-panel">
            <div className="answer-block meaning-block">
              <span>剧中含义</span>
              <p>{currentCard.meaning}</p>
            </div>
            {currentCard.sceneContext && (
              <div className="answer-block">
                <span>场景</span>
                <p>{currentCard.sceneContext}</p>
              </div>
            )}
            {currentCard.personalExample && (
              <div className="answer-block example-block">
                <span>我的例句</span>
                <p>{currentCard.personalExample}</p>
                <IconButton
                  label="朗读例句"
                  onClick={() => onSpeak(currentCard.personalExample)}
                >
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
            <strong>忘了</strong><span>10 分钟</span>
          </button>
          <button className="rating hard" type="button" onClick={() => onRate("hard")}>
            <strong>吃力</strong><span>短间隔</span>
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
                  <span>{card.pronunciation}</span>
                </div>
                <IconButton label={`朗读 ${card.expression}`} onClick={() => onSpeak(card.expression)}>
                  <Volume2 size={18} />
                </IconButton>
              </div>
              <div className="meaning-cell">
                <p>{card.meaning}</p>
                <span>{card.originalLine}</span>
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
          <div className="form-grid two-columns">
            <label>
              <span>英语表达 *</span>
              <input
                autoFocus
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
          </div>

          <label>
            <span>这一幕里的含义 *</span>
            <textarea
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
            <span>我的例句</span>
            <textarea
              value={form.personalExample}
              onChange={(event) => update("personalExample", event.target.value)}
              placeholder="写一句与你自己的生活有关的话"
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
