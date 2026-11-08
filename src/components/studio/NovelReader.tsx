"use client";

import {
  ChevronLeft,
  ChevronRight,
  List,
  Pause,
  Play,
  Settings2,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  SPEECH_PITCH_MAX,
  SPEECH_PITCH_MIN,
  SPEECH_RATE_MAX,
  SPEECH_RATE_MIN,
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  loadReaderSettings,
  READER_DEFAULTS,
  READER_FONT_LABEL,
  READER_FONT_STACK,
  READER_FONTS,
  READER_THEME_COLORS,
  READER_THEME_LABEL,
  READER_THEMES,
  READING_MODE_HINT,
  READING_MODE_LABEL,
  READING_MODES,
  saveReaderSettings,
  type ReaderSettings,
} from "@/lib/novel-reader-view";
import { ReadingRail } from "@/components/studio/ReadingRail";
import { castChunks, type CastMember } from "@/lib/narration";
import {
  loadVoices,
  speak,
  speechSupported,
  splitForSpeech,
  type SpeechHandle,
  type Voice,
} from "@/lib/speech";
import { useScriptConverter } from "@/lib/use-script-conversion";
import { cn } from "@/lib/utils";

/**
 * 小說閱讀器.
 *
 * The editor is for writing; this is for reading what was written, in one
 * continuous book rather than one episode at a time. Everything it offers —
 * type size, line spacing, reading direction, page colour, dimming — is a
 * property of the person and the screen, so it is kept in `localStorage` and
 * never sent to the server: one member's phone must not resize the other's
 * desk.
 *
 * Three reading modes, because they are genuinely different habits and not
 * skins of each other: a scroll, discrete pages, and pages with the turn
 * animated. `prefers-reduced-motion` collapses 模擬翻書 to a plain page change,
 * since a 0.4s rotation on every page is exactly what that setting is for.
 */

export type ReaderChapter = {
  id: string;
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  chapterTitle: string;
  /** Paragraphs, already converted from the editor's HTML on the server. */
  paragraphs: string[];
  charCount: number;
};

export function NovelReader({
  bookTitle,
  chapters,
  cast = [],
  initialChapterId,
  exitHref,
}: {
  bookTitle: string;
  chapters: ReaderChapter[];
  /** 分角色朗讀用的角色名單 (Z111)。空陣列＝全部用旁白聲。 */
  cast?: CastMember[];
  initialChapterId?: string | undefined;
  /** Where 退出 goes — the shelf, or the editor it was opened from. */
  exitHref: string;
}) {
  /*
   * `localStorage` does not exist during the server render.
   * `useSyncExternalStore` rather than an effect, which is what
   * `react-hooks/set-state-in-effect` forbids and exactly the
   * "read a client-only value" case it is for — same pattern as `Dialog`.
   */
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const [stored, setStored] = useState<ReaderSettings | null>(null);
  const settings = stored ?? (ready ? loadReaderSettings() : READER_DEFAULTS);
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "toc" | "settings">("none");

  /* ---------------------------------------------------------------- 朗讀 */

  const [voices, setVoices] = useState<Voice[]>([]);
  const [reading, setReading] = useState<"off" | "playing" | "paused">("off");
  /** Which chunk is being spoken, for the highlight. */
  const [spokenAt, setSpokenAt] = useState(-1);
  const speechRef = useRef<SpeechHandle | null>(null);
  const spokenRef = useRef<HTMLParagraphElement | null>(null);
  const [index, setIndex] = useState(() => {
    const found = chapters.findIndex((c) => c.id === initialChapterId);
    return found >= 0 ? found : 0;
  });
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [turning, setTurning] = useState<"none" | "next" | "prev">("none");

  const pagerRef = useRef<HTMLDivElement | null>(null);

  const update = useCallback((changes: Partial<ReaderSettings>) => {
    setStored((current) => {
      const next = { ...(current ?? loadReaderSettings()), ...changes };
      saveReaderSettings(next);
      return next;
    });
  }, []);

  const chapter = chapters[index];
  const theme = READER_THEME_COLORS[settings.theme];
  const paged = settings.mode !== "scroll";

  /* --------------------------------------------------------------- paging */

  /**
   * How many columns the text actually occupies.
   *
   * Measured from the scroll width rather than estimated from the character
   * count: CSS columns decide where the text breaks, and any estimate here
   * would disagree with them and leave a page that cannot be reached.
   */
  /*
   * 正文自己的繁簡轉換 (Z135, 改寫於 Z172)。
   *
   * 本來跟介面那一份共用改 DOM 的 `useScriptConversion`，而那一支只跑繁 → 簡
   * ——所以上傳一本**簡體**小說之後，選「繁體」只是把轉換關掉，看到的還是簡
   * 體。那個設計裡「繁體」的意思是「不要轉」，因為它假設原文一定是繁體。
   *
   * 改成從原始字串轉：兩個方向都走得通，而且每次都從作者寫的那份算起，不會
   * 有繁 → 簡 → 繁 的有損來回。這一欄仍然標 `data-script-own`，介面那份照樣
   * 跳過它。
   */
  const script = useScriptConverter(settings.script);

  const measure = useCallback(() => {
    const node = pagerRef.current;
    if (!node || !paged) return;

    const width = node.clientWidth;
    if (width <= 0) return;

    const total = Math.max(1, Math.round(node.scrollWidth / width));
    setPageCount(total);
    setPage((current) => Math.min(current, total - 1));
  }, [paged]);

  useEffect(() => {
    measure();
  }, [
    measure,
    index,
    settings.fontSize,
    settings.lineHeight,
    settings.font,
    ready,
    /*
     * 繁簡也會改變行數 (Z172).
     *
     * 分頁是量 `scrollWidth / clientWidth` 量出來的，而換一種字形之後同一段
     * 話的斷行位置會變。少了這一條，切換繁簡之後頁數還是舊的——最後一頁可能
     * 翻不到，或是多出一頁空白。
     *
     * `script` 本身也在相依裡：字典是動態載入的，載完那一刻正文才真的變成另
     * 一種字形，而那是第一次繪製之後的事。
     */
    settings.script,
    script,
  ]);

  useEffect(() => {
    if (!paged) return;
    const node = pagerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure, paged]);

  useEffect(() => {
    const node = pagerRef.current;
    if (node && paged)
      node.scrollTo({ left: page * node.clientWidth, behavior: "auto" });
  }, [page, paged]);

  const goChapter = useCallback(
    (next: number) => {
      if (next < 0 || next >= chapters.length) return;
      setIndex(next);
      setPage(0);

      /*
       * 回到新一章的開頭 (Z134).
       *
       * 回報：「跳下一章還是直接跳中間」。捲動模式的正文在 `pageRef` 這個
       * 容器裡，而這裡只重設了 `pagerRef`（橫向翻頁用的）跟 `window`——
       * 閱讀器是 `fixed inset-0`，window 根本不會捲，所以那一行從來沒有做
       * 過任何事。上一章捲到哪，新一章就從哪裡開始。
       */
      pageRef.current?.scrollTo({ top: 0, behavior: "auto" });
      pagerRef.current?.scrollTo({ left: 0, behavior: "auto" });
    },
    [chapters.length],
  );

  const flip = useCallback(
    (direction: "next" | "prev") => {
      if (!paged) {
        goChapter(index + (direction === "next" ? 1 : -1));
        return;
      }

      const target = page + (direction === "next" ? 1 : -1);

      // Past either end of the chapter, carry on into the next one rather
      // than stopping — a book does not stop at a chapter boundary.
      if (target < 0) {
        if (index > 0) goChapter(index - 1);
        return;
      }
      if (target >= pageCount) {
        if (index < chapters.length - 1) goChapter(index + 1);
        return;
      }

      if (settings.mode === "flip" && !prefersReducedMotion()) {
        setTurning(direction);
        window.setTimeout(() => {
          setPage(target);
          setTurning("none");
        }, 180);
      } else {
        setPage(target);
      }
    },
    [paged, page, pageCount, index, chapters.length, goChapter, settings.mode],
  );

  const chunks = useMemo(() => {
    if (!chapter) return [];

    /*
     * 朗讀用的是**原值**，不走 `script()` (Z174).
     *
     * 這是故意的，而且它沒有被寫下來過——子代理審的時候問了，而「顯示轉了、
     * 朗讀沒轉」正是下一個人會順手「修掉」的那種不一致。三個理由：
     *
     *  1. 簡 → 繁 是一對多，餵轉換後的字給語音引擎等於多疊一層猜測（`着`／
     *     `著` 的讀音不同）。原始字串是作者寫的，那才是該讀出來的。
     *  2. 角色名比對的兩邊都來自資料庫（`cast` 的名字對段落），字形一致；
     *     只轉一邊會讓分角色朗讀開始對不上。
     *  3. 高亮走的是段落索引，不是文字，所以顯示轉換不影響它。
     */
    const plain = splitForSpeech(chapter.paragraphs);

    /*
     * 分角色朗讀 (Z111). Off unless asked for, and a no-op without a cast —
     * `castChunks` then returns the chunks untouched, so the narrator reads
     * everything exactly as before.
     */
    if (!settings.castVoices || cast.length === 0) return plain;

    return castChunks(
      plain,
      chapter.paragraphs,
      cast,
      voices.map((voice) => ({ id: voice.id, lang: voice.lang })),
    );
  }, [chapter, cast, settings.castVoices, voices]);

  useEffect(() => {
    if (!speechSupported()) return;
    let cancelled = false;
    void loadVoices().then((list) => {
      if (!cancelled) setVoices(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopReading = useCallback(() => {
    speechRef.current?.stop();
    speechRef.current = null;
    setReading("off");
    setSpokenAt(-1);
  }, []);

  /*
   * Hands the scrollbar gutter back while the reader is open.
   *
   * `fixed inset-0` is laid out against the viewport minus `html`'s reserved
   * gutter, so without this the reader stops 10px short of the right edge and
   * the studio's near-black shows through beside the page.
   */
  useEffect(() => {
    document.documentElement.classList.add("is-reading");
    return () => document.documentElement.classList.remove("is-reading");
  }, []);

  // Leaving the page must silence it. Speech is a global queue that outlives
  // the component, so an unmounted reader would keep talking.
  useEffect(() => () => stopReading(), [stopReading]);

  const startReading = useCallback(() => {
    if (chunks.length === 0) return;

    speechRef.current?.stop();
    setReading("playing");

    speechRef.current = speak(chunks, {
      voiceId: settings.voiceId || undefined,
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      volume: 1,
      // The paragraph, not the chunk — a long paragraph is several chunks.
      onBoundary: (paragraph) => setSpokenAt(paragraph),
      onEnd: () => {
        /*
         * 唸完的 handle 要丟掉 (Z134).
         *
         * 回報：「朗讀完一章跳下一章就沒聲音了」。接力的 effect 第一件事是
         * `if (speechRef.current) return`，而這裡只設了 `reading`，沒有把
         * 已經唸完的 handle 清掉——所以它每次都在那一行掉頭走人，下一章永遠
         * 不會開口。狀態說停了，ref 說還在，中間那個 effect 信了 ref。
         */
        speechRef.current = null;
        setReading("off");
        setSpokenAt(-1);
        /*
         * Roll into the next chapter. Reading a novel aloud and stopping dead
         * at every chapter break is the one thing this feature exists to
         * avoid.
         */
        if (index < chapters.length - 1) {
          goChapter(index + 1);
          // The new chapter's chunks are not computed yet; let the render
          // settle before speaking them.
          window.setTimeout(() => setReading("playing"), 50);
        }
      },
      onError: () => {
        speechRef.current = null;
        setReading("off");
        setSpokenAt(-1);
      },
    });
  }, [
    chunks,
    settings.voiceId,
    settings.speechRate,
    settings.speechPitch,
    index,
    chapters.length,
    goChapter,
  ]);

  /*
   * Picks the reading back up after an automatic chapter change. Keyed on the
   * chunks rather than the index, so it runs once the new text is ready.
   */
  const autoplay = useRef(false);

  useEffect(() => {
    if (reading !== "playing") return;
    if (speechRef.current) return;
    if (!autoplay.current) {
      autoplay.current = true;
      return;
    }
    startReading();
  }, [chunks, reading, startReading]);

  /** Follows the voice down the page, so reading along needs no scrolling. */
  useEffect(() => {
    if (reading !== "playing" || spokenAt < 0) return;
    spokenRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [spokenAt, reading]);

  /* ------------------------------------------------------------- gestures */

  const touch = useRef<{ x: number; y: number } | null>(null);
  /** The scrolling prose column, for the reading rail. */
  const pageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") flip("next");
      if (event.key === "ArrowLeft" || event.key === "PageUp") flip("prev");
      if (event.key === "Escape") {
        // Closes the drawer first; a second press leaves the reader.
        if (panel !== "none") setPanel("none");
        else router.push(exitHref);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, panel, router, exitHref]);

  /* --------------------------------------------------------------- render */

  if (!chapter) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink-200">還沒有可以讀的內容</p>
          <p className="text-[11px] text-ink-600">
            在小說編輯器寫下第一章之後，這裡就會有東西。
          </p>
        </div>
      </div>
    );
  }

  const body = (
    <article
      /*
       * 正文的繁簡由閱讀器自己決定 (Z135，範圍在 Z174 收緊).
       *
       * `data-script-own` 讓整個介面的那份轉換跳過這一塊。分開是因為它們是兩
       * 件事：介面是給操作的人看的，正文是作品本身——有人想用簡體介面讀繁體
       * 原文，也有人反過來。綁在一起就少了那兩種讀法。
       */
      data-script-own
      className="reader-prose"
      style={{
        fontFamily: READER_FONT_STACK[settings.font],
        fontSize: `${settings.fontSize}px`,
        lineHeight: settings.lineHeight,
        color: theme.ink,
      }}
    >
      <header className="mb-6">
        <p
          className="mb-1 text-center"
          style={{ fontSize: "0.7em", color: theme.faint }}
        >
          EP{String(chapter.episodeNumber).padStart(3, "0")}
          {chapter.episodeTitle && `・${script(chapter.episodeTitle)}`}
        </p>
        <h2 className="text-center font-medium" style={{ fontSize: "1.15em" }}>
          {script(chapter.chapterTitle || chapter.episodeTitle || "未命名")}
        </h2>
      </header>

      {/*
        One <p> per real paragraph, reading or not.

        It used to render the *chunks* while reading, so the highlight could
        land on a sentence — which meant pressing play reflowed the whole
        page into different paragraphs. That was invisible only as long as
        every paragraph happened to fit in one utterance. Now that a long
        paragraph is deliberately split into several short ones, rendering
        chunks would visibly shatter the prose the moment you pressed play.

        So the chunk carries its paragraph index and the highlight follows
        that. In this novel a paragraph is mostly one line of dialogue, so
        the granularity is barely different from before.
      */}
      {chapter.paragraphs.map((paragraph, i) => (
        <p
          key={i}
          ref={i === spokenAt ? spokenRef : undefined}
          style={{
            textIndent: "2em",
            margin: "0 0 0.9em",
            transition: "background-color 160ms",
            ...(reading !== "off" && i === spokenAt
              ? { backgroundColor: `${theme.faint}33`, borderRadius: "0.25em" }
              : {}),
          }}
        >
          {script(paragraph)}
        </p>
      ))}
    </article>
  );

  return (
    <div
      /*
       * The whole viewport, over the studio chrome.
       *
       * Reading is the one thing here that wants the screen to itself: the
       * rail, the tab strip and the breadcrumb are all navigation for making
       * the thing, not for reading it. 100dvh rather than 100vh so a phone's
       * address bar sliding away does not leave a strip of page behind.
       *
       * Above the rail (z-50) and the floating chat, or they sit on top of
       * the page and the 退出 button is behind the sidebar.
       */
      className="reader-surface fixed inset-0 z-[60] flex flex-col transition-colors"
      style={{ background: theme.bg }}
    >
      {/*
        Replaces the browser's scrollbar, which `.reader-surface` hides. See
        `ReadingRail` for why it is not simply hidden and left at that.
      */}
      <ReadingRail
        containerRef={pageRef}
        color={theme.faint}
        enabled={!paged}
      />

      {/*
        Dimming is an overlay rather than a CSS `filter` on the content: a
        filter creates a containing block, which breaks `position: fixed` for
        anything inside it — including the settings panel.
      */}
      {settings.brightness < 1 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[65] bg-black"
          style={{ opacity: 1 - settings.brightness }}
        />
      )}

      {/* ---- toolbar ---------------------------------------------------- */}
      {/*
        手機上只留圖示，文字從 `sm` 才出現 (Z176).

        這一列在 390px 下最多塞六個東西：退出、目錄、書名、朗讀、停止、閱讀設
        定——而中間那個書名是 `flex-1 truncate`，所以**它是唯一會被壓扁的那一
        個**。結果是書名被切成兩三個字，而四組「圖示＋兩字」各自佔著寬度。
        朗讀中的時候最糟，因為那時候才會多出「停止」那一顆。

        拿掉文字而不是縮小字級或改成兩行：兩行會把正文往下推（這是一個以正文
        為主的畫面），縮字級則是讓六個東西一起變難按。圖示本來就都有
        `aria-label` 與 `title`，所以拿掉可見文字不會讓任何一顆變成猜謎——
        `目錄` 跟 `閱讀設定` 原本沒有，這次補上。

        `gap-2 → gap-1`、`px-3 → px-2` 也只在手機上縮，桌機維持原樣。
      */}
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-2 backdrop-blur-sm sm:gap-2 sm:px-3"
        style={{
          borderColor: `${theme.faint}33`,
          background: `${theme.bg}e6`,
          color: theme.ink,
        }}
      >
        {/*
          Leaves the reader entirely rather than collapsing it. A full-screen
          surface with no visible way out is the thing people close the tab
          over.
        */}
        <Link
          href={exitHref}
          aria-label="退出閱讀器"
          title="退出閱讀器"
          className="tap inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-opacity hover:opacity-70"
        >
          <X aria-hidden className="size-3.5" />
          <span className="hidden sm:inline">退出</span>
        </Link>

        <button
          type="button"
          onClick={() => setPanel(panel === "toc" ? "none" : "toc")}
          aria-label="目錄"
          title="目錄"
          className="tap inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-opacity hover:opacity-70 sm:px-2"
        >
          <List aria-hidden className="size-3.5" />
          <span className="hidden sm:inline">目錄</span>
        </button>

        <span
          className="min-w-0 flex-1 truncate text-center text-[11px]"
          style={{ color: theme.faint }}
        >
          {bookTitle}
        </span>

        {/*
          Only when the browser can actually synthesise speech. Linux without
          a speech engine has no voices at all, and a play button that does
          nothing is worse than no play button.
        */}
        {/*
          `ready &&`，不然整頁 hydration 失敗 (Z175).

          `speechSupported()` 讀的是 `window.speechSynthesis`，而它**在 render
          當中被呼叫**：伺服器端算出 false、用戶端算出 true，於是 React 拿到兩
          份不一樣的樹，整個子樹被丟掉重畫。那正是錯誤訊息第一條講的
          「server/client branch」。

          這個錯在 Z173 之前看不到——頁面根本沒有 hydrate，所以不可能有
          hydration 錯誤。修掉跨來源封鎖才讓它現形，而它在提交過的版本上同樣存
          在（驗過：只暫存 src/、保留設定，錯誤照出現）。

          `ready` 是這個檔案本來就有的 hydration 安全旗標（`useSyncExternalStore`
          在伺服器端回 false），所以兩邊第一次繪製都是 false，朗讀入口在 hydrate
          之後才出現。
        */}
        {ready && speechSupported() && (
          <>
            <button
              type="button"
              onClick={() => {
                if (reading === "playing") {
                  speechRef.current?.pause();
                  setReading("paused");
                } else if (reading === "paused") {
                  speechRef.current?.resume();
                  setReading("playing");
                } else {
                  startReading();
                }
              }}
              aria-label={reading === "playing" ? "暫停朗讀" : "朗讀"}
              title={reading === "playing" ? "暫停朗讀" : "朗讀這一章"}
              className="tap inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-opacity hover:opacity-70 sm:px-2"
            >
              {reading === "playing" ? (
                <Pause aria-hidden className="size-3.5" />
              ) : (
                <Play aria-hidden className="size-3.5" />
              )}
              <span className="hidden sm:inline">
                {reading === "off"
                  ? "朗讀"
                  : reading === "paused"
                    ? "繼續"
                    : "暫停"}
              </span>
            </button>

            {reading !== "off" && (
              <button
                type="button"
                onClick={stopReading}
                aria-label="停止朗讀"
                title="停止朗讀"
                className="tap inline-flex items-center rounded-md px-1.5 py-1 transition-opacity hover:opacity-70"
              >
                <Square aria-hidden className="size-3" />
              </button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => setPanel(panel === "settings" ? "none" : "settings")}
          aria-label="閱讀設定"
          title="閱讀設定"
          className="tap inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-opacity hover:opacity-70 sm:px-2"
        >
          <Settings2 aria-hidden className="size-3.5" />
          <span className="hidden sm:inline">閱讀設定</span>
        </button>
      </div>

      {/* ---- the page --------------------------------------------------- */}
      <div
        ref={pageRef}
        /*
         * `data-script-own` 從這個 div 搬到裡面的 `<article>` 上 (Z174).
         *
         * 這個 div 除了正文還包著翻頁導覽列（上一頁／下一頁／第 N / M 章）。
         * Z135 時代這裡標 `data-script-own` 沒問題，因為正文那一份是
         * **改 DOM** 的、root 就是這個 div，所以導覽列跟著一起轉。
         *
         * Z172 把正文改成在資料層轉，只包了段落、集名、章名三處——導覽列於
         * 是**誰都不轉**：介面那一份看到 `data-script-own` 就跳過，正文那一份
         * 沒有碰它。簡體介面配簡體正文，底下還是「上一頁／下一頁」。
         *
         * 導覽列是介面，不是作品，所以它該跟著介面設定走。把標記縮到
         * `<article>`（真正屬於作品的那一塊）就兩邊都對了。
         */
        className="relative mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-8 sm:px-8"
        onTouchStart={(event) => {
          const point = event.touches[0];
          if (point) touch.current = { x: point.clientX, y: point.clientY };
        }}
        onTouchEnd={(event) => {
          const start = touch.current;
          const point = event.changedTouches[0];
          touch.current = null;
          if (!start || !point || !paged) return;

          const dx = point.clientX - start.x;
          const dy = point.clientY - start.y;
          // Only a mostly-horizontal swipe turns a page; otherwise a diagonal
          // scroll flips pages while someone is trying to scroll.
          if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;

          flip(dx < 0 ? "next" : "prev");
        }}
      >
        {paged ? (
          <div
            className={cn(
              "origin-left transition-transform duration-150",
              settings.mode === "flip" &&
                turning === "next" &&
                "scale-x-[0.97] opacity-80",
              settings.mode === "flip" &&
                turning === "prev" &&
                "scale-x-[1.03] opacity-80",
            )}
            style={{
              perspective: settings.mode === "flip" ? "1600px" : undefined,
            }}
          >
            <div
              ref={pagerRef}
              className="overflow-hidden"
              style={{
                height: "calc(100dvh - 15rem)",
                columnWidth: "100vw",
                columnGap: 0,
                columnFill: "auto",
              }}
            >
              {body}
            </div>
          </div>
        ) : (
          body
        )}

        {/* ---- chapter / page controls -------------------------------- */}
        <nav
          className="mt-6 flex items-center justify-between gap-3 text-[11px]"
          style={{ color: theme.faint }}
        >
          <button
            type="button"
            onClick={() => flip("prev")}
            disabled={index === 0 && page === 0}
            className="tap inline-flex items-center gap-1 rounded-md px-2 py-1 transition-opacity hover:opacity-70 disabled:opacity-30"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            {paged ? "上一頁" : "上一章"}
          </button>

          <span className="tabular-nums">
            {paged && `${page + 1} / ${pageCount}　`}第 {index + 1} /{" "}
            {chapters.length} 章
          </span>

          <button
            type="button"
            onClick={() => flip("next")}
            disabled={
              index === chapters.length - 1 && (!paged || page >= pageCount - 1)
            }
            className="tap inline-flex items-center gap-1 rounded-md px-2 py-1 transition-opacity hover:opacity-70 disabled:opacity-30"
          >
            {paged ? "下一頁" : "下一章"}
            <ChevronRight aria-hidden className="size-3.5" />
          </button>
        </nav>
      </div>

      {/* ---- panels ----------------------------------------------------- */}
      {panel !== "none" && (
        <>
          <button
            type="button"
            aria-label="關閉面板"
            onClick={() => setPanel("none")}
            className="fixed inset-0 z-[70] cursor-default bg-black/40"
          />
          <div
            /*
              A side drawer at every width. It used to be a bottom sheet below
              `sm`, which made sense when the reader was a page inside the
              studio — it is not any more, and a table of contents that slides
              up from the floor of a full-screen reader reads as something
              that went wrong.
            */
            className={cn(
              "fixed inset-y-0 z-[75] w-[min(20rem,85vw)] overflow-y-auto p-4 shadow-2xl",
              /*
                A drawer comes in from the side its button is on. 目錄 sits at
                the left of the header next to 退出, so reaching for it and
                having the panel arrive from the opposite edge reads as the
                wrong panel opening.
              */
              panel === "toc"
                ? "animate-slide-right left-0 border-r"
                : "animate-slide-left right-0 border-l",
            )}
            style={{
              background: theme.bg,
              borderColor: `${theme.faint}44`,
              color: theme.ink,
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold">
                {panel === "toc" ? "目錄" : "閱讀設定"}
              </h3>
              <button
                type="button"
                onClick={() => setPanel("none")}
                aria-label="關閉"
                className="rounded p-1 transition-opacity hover:opacity-70"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            {panel === "toc" ? (
              // `data-script-own`：篇名走正文那一套，見下面的註解 (Z174)。
              <ol data-script-own className="flex flex-col gap-0.5">
                {chapters.map((item, i) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        goChapter(i);
                        setPanel("none");
                      }}
                      /*
                       * 目錄的字要能讀 (Z138).
                       *
                       * 原本是 `text-[11px]`——那是介面標籤的尺寸，而這是一份
                       * 要翻一百二十集的清單，是閱讀的一部分，不是 chrome。
                       * 列高也一起加大：在手機上用拇指點 11px 高的一行，點到
                       * 隔壁的機率比點到自己高。
                       */
                      className="flex w-full items-baseline gap-2 rounded-md px-2 py-2.5 text-left text-[14px] transition-colors"
                      style={
                        i === index
                          ? { background: `${theme.faint}2a`, fontWeight: 600 }
                          : undefined
                      }
                    >
                      {/* 集號與字數留在小一級：要讀的是篇名，那兩個是定位用的。 */}
                      <span
                        className="shrink-0 text-[11px] tabular-nums"
                        style={{ color: theme.faint }}
                      >
                        {String(item.episodeNumber).padStart(3, "0")}
                      </span>
                      {/*
                        篇名走正文那一套，不走介面那一套 (Z174).

                        這個抽屜是 `data-script-own` 的**兄弟節點**，所以它本
                        來由介面那一份轉，用的是介面偏好；而同一個篇名在正文
                        標頭上由 `script()` 轉，用的是正文偏好。兩個偏好刻意
                        分開（那是設計），結果是同一個篇名在同一個畫面上一邊
                        繁一邊簡。

                        篇名是作品的字，所以跟著正文走。外面那層 `<ol>` 標了
                        `data-script-own`，介面那一份因此不碰這裡。
                      */}
                      <span className="min-w-0 flex-1 truncate">
                        {script(item.chapterTitle || item.episodeTitle || "未命名")}
                      </span>
                      <span
                        className="shrink-0 text-[11px] tabular-nums"
                        style={{ color: theme.faint }}
                      >
                        {item.charCount.toLocaleString("en-US")}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex flex-col gap-4">
                <Field label="閱讀方式" hint={READING_MODE_HINT[settings.mode]}>
                  <div className="grid grid-cols-3 gap-1">
                    {READING_MODES.map((mode) => (
                      <Choice
                        key={mode}
                        active={settings.mode === mode}
                        theme={theme}
                        onClick={() => {
                          update({ mode });
                          setPage(0);
                        }}
                      >
                        {READING_MODE_LABEL[mode]}
                      </Choice>
                    ))}
                  </div>
                </Field>

                <Field label="背景">
                  <div className="grid grid-cols-5 gap-1">
                    {READER_THEMES.map((key) => {
                      const colors = READER_THEME_COLORS[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => update({ theme: key })}
                          aria-label={READER_THEME_LABEL[key]}
                          aria-pressed={settings.theme === key}
                          title={READER_THEME_LABEL[key]}
                          className={cn(
                            "flex h-10 flex-col items-center justify-center rounded-md border text-[9px] transition-all",
                            settings.theme === key
                              ? "ring-2"
                              : "opacity-80 hover:opacity-100",
                          )}
                          style={{
                            background: colors.bg,
                            color: colors.ink,
                            borderColor: `${colors.faint}66`,
                            ...(settings.theme === key
                              ? ({
                                  "--tw-ring-color": theme.ink,
                                } as React.CSSProperties)
                              : {}),
                          }}
                        >
                          {READER_THEME_LABEL[key]}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label="字體">
                  <div className="grid grid-cols-2 gap-1">
                    {READER_FONTS.map((font) => (
                      <Choice
                        key={font}
                        active={settings.font === font}
                        theme={theme}
                        onClick={() => update({ font })}
                      >
                        <span style={{ fontFamily: READER_FONT_STACK[font] }}>
                          {READER_FONT_LABEL[font]}
                        </span>
                      </Choice>
                    ))}
                  </div>
                </Field>

                <Slider
                  label="字級"
                  value={settings.fontSize}
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  step={1}
                  display={`${settings.fontSize}px`}
                  theme={theme}
                  onChange={(fontSize) => update({ fontSize })}
                />

                <Slider
                  label="行距"
                  value={settings.lineHeight}
                  min={LINE_HEIGHT_MIN}
                  max={LINE_HEIGHT_MAX}
                  step={0.05}
                  display={settings.lineHeight.toFixed(2)}
                  theme={theme}
                  onChange={(lineHeight) => update({ lineHeight })}
                />

                <Slider
                  label="亮度"
                  value={settings.brightness}
                  min={BRIGHTNESS_MIN}
                  max={BRIGHTNESS_MAX}
                  step={0.05}
                  display={`${Math.round(settings.brightness * 100)}%`}
                  theme={theme}
                  onChange={(brightness) => update({ brightness })}
                />

                {/* `ready &&` 的理由見上面朗讀入口那一段 (Z175)。 */}
                {/*
                  字形選單不綁在語音引擎上 (Z174).

                  它原本縮在下面那個 `{ready && speechSupported() && (` 裡面，跟
                  朗讀音色、語速、分角色朗讀擺在一起——於是**沒有裝語音引擎的裝
                  置連正文繁簡都切不了**。兩件事毫無關係，而這個錯只在少數裝置
                  上出現，所以不會有人回報。讓它現形的是瀏覽器 probe：headless
                  Chrome 沒有語音引擎，所以那三顆按鈕一顆都抓不到。

                  **而我搬錯地方了**：第一版用「檔案裡第一個 `speechSupported()`」
                  定位，而那是**工具列上的播放鍵**，不是這個面板——於是整個 Field
                  連標籤帶說明一起跑到閱讀器頂部，把手機上的 header 擠爆。`tsc`、
                  `lint`、`next build` 全綠，probe 也全過（它找 `[role="radio"]`，
                  在哪一層都找得到）。是人看到畫面才發現的。

                  教訓：`next()` 回的是第一個命中，而「第一個」跟「我要的那個」
                  是兩件事。
                */}
                {/*
                  正文的繁簡 (Z135).

                  Separate from the interface switch on purpose: somebody
                  may want a 简体 interface around 繁體 prose, or the
                  other way round. Tying them together removes both of
                  those readings.
                */}
                <Field label="正文字體">
                  <div
                    data-script-keep
                    className="flex gap-1 rounded-md border p-0.5"
                    style={{ borderColor: `${theme.faint}55` }}
                  >
                    {/*
                      三顆，而本來只有兩顆 (Z174).

                      舊的兩顆是「简体」跟「繁體（原文）」，而那個標籤把
                      兩件事綁成一件：它假設原文就是繁體，所以「不轉換」
                      等於「繁體」。稿子是簡體寫的，所以按那一顆什麼都不
                      會發生——Z172 做出了簡 → 繁 的轉換，而**沒有任何一顆
                      按鈕選得到它**。

                      拆開之後：原文＝不轉、简体＝轉成簡體、繁體＝轉成繁
                      體。對今天的稿子，前兩顆看起來一樣，而那是誠實的
                      ——它們真的做的是兩件不同的事，只是在簡體稿上結果
                      相同；哪天混進繁體的章節就分得出來了。
                    */}
                    {(
                      [
                        ["original", "原文"],
                        ["simplified", "简体"],
                        ["traditional", "繁體"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={settings.script === value}
                        onClick={() => update({ script: value })}
                        className="tap flex-1 rounded px-1.5 py-1 text-[11px] transition-opacity"
                        style={
                          settings.script === value
                            ? {
                                background: `${theme.faint}33`,
                                color: theme.ink,
                              }
                            : { color: theme.faint }
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>
                {ready && speechSupported() && (
                  <>
                    <Field
                      label="朗讀音色"
                      hint={
                        voices.length === 0
                          ? "這台裝置沒有裝語音引擎"
                          : "音色來自作業系統，換一台電腦清單會不一樣。"
                      }
                    >
                      <select
                        value={settings.voiceId}
                        onChange={(event) => {
                          update({ voiceId: event.target.value });
                          // Restart so the change is audible immediately
                          // rather than at the next chapter.
                          if (reading !== "off") {
                            stopReading();
                            window.setTimeout(startReading, 60);
                          }
                        }}
                        disabled={voices.length === 0}
                        className="w-full rounded-md border px-2 py-1.5 text-[11px]"
                        style={{
                          background: "transparent",
                          borderColor: `${theme.faint}55`,
                          color: theme.ink,
                        }}
                      >
                        <option value="">系統預設</option>
                        {voices.map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name}（{voice.lang}）
                          </option>
                        ))}
                      </select>
                    </Field>


                    {/*
                      分角色朗讀 (Z111).

                      Only offered when this work has characters to match
                      against — with none, the toggle would be a switch that
                      provably does nothing.
                    */}
                    {cast.length > 0 && (
                      <Field
                        label="分角色朗讀"
                        hint={`對白換成角色的聲音，語氣也會調語速。認不出是誰說的就用旁白聲。這部作品有 ${cast.length} 個角色。`}
                      >
                        <button
                          type="button"
                          role="switch"
                          aria-checked={settings.castVoices}
                          onClick={() => {
                            update({ castVoices: !settings.castVoices });
                            if (reading !== "off") {
                              stopReading();
                              window.setTimeout(startReading, 60);
                            }
                          }}
                          className="tap flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-[11px]"
                          style={{
                            borderColor: `${theme.faint}55`,
                            color: theme.ink,
                          }}
                        >
                          <span>
                            {settings.castVoices
                              ? "開著"
                              : "關著（全部旁白聲）"}
                          </span>
                          <span
                            aria-hidden
                            className="relative inline-block h-4 w-7 rounded-full transition-colors"
                            style={{
                              background: settings.castVoices
                                ? theme.ink
                                : `${theme.faint}55`,
                            }}
                          >
                            <span
                              className="absolute top-0.5 size-3 rounded-full transition-all"
                              style={{
                                background: theme.bg,
                                left: settings.castVoices
                                  ? "0.875rem"
                                  : "0.125rem",
                              }}
                            />
                          </span>
                        </button>
                      </Field>
                    )}

                    <Slider
                      label="朗讀語速"
                      value={settings.speechRate}
                      min={SPEECH_RATE_MIN}
                      max={SPEECH_RATE_MAX}
                      step={0.05}
                      display={`${settings.speechRate.toFixed(2)}×`}
                      theme={theme}
                      onChange={(speechRate) => update({ speechRate })}
                    />

                    <Slider
                      label="朗讀音調"
                      value={settings.speechPitch}
                      min={SPEECH_PITCH_MIN}
                      max={SPEECH_PITCH_MAX}
                      step={0.05}
                      display={settings.speechPitch.toFixed(2)}
                      theme={theme}
                      onChange={(speechPitch) => update({ speechPitch })}
                    />
                  </>
                )}

                <p
                  className="text-[10px] leading-relaxed"
                  style={{ color: theme.faint }}
                >
                  這些設定只存在這台裝置的瀏覽器裡，不會同步給另一位成員。
                  <br />
                  朗讀用瀏覽器內建的語音合成，不計費也不用聯網。
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-[10px] opacity-60">{hint}</span>}
    </div>
  );
}

function Choice({
  active,
  theme,
  onClick,
  children,
}: {
  active: boolean;
  theme: { ink: string; faint: string };
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-md border px-2 py-1.5 text-[11px] transition-all"
      style={{
        borderColor: active ? theme.ink : `${theme.faint}55`,
        fontWeight: active ? 600 : 400,
        opacity: active ? 1 : 0.7,
      }}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  theme,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  theme: { ink: string; faint: string };
  onChange: (value: number) => void;
}) {
  const id = `reader-${label}`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-baseline justify-between text-[11px] font-medium"
      >
        {label}
        <span className="tabular-nums" style={{ color: theme.faint }}>
          {display}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full"
        style={{ background: `${theme.faint}55`, accentColor: theme.ink }}
      />
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Never changes, so `useSyncExternalStore` only needs the two snapshots. */
function subscribeNever(): () => void {
  return () => {};
}
