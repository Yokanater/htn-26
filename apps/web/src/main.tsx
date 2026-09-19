import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Coffee,
  Compass,
  ExternalLink,
  FileText,
  FlaskConical,
  Globe2,
  LayoutGrid,
  Leaf,
  Link2,
  LoaderCircle,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sprout,
  Target,
  ThumbsDown,
  ThumbsUp,
  Users,
  X,
} from "lucide-react";
import {
  phases,
  terminal,
  type Candidate,
  type Profile,
  type Report,
  type Evidence,
} from "../../../packages/contracts/src/index";
import "./styles.css";

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || "Could not complete that request. Try again.",
    );
  return data as T;
}
const phaseLabels = [
  "Getting ready",
  "Reviewing your profile",
  "Finding your ecosystem",
  "Gathering the evidence",
  "Connecting the dots",
  "Exploring the possibilities",
  "Bringing it all together",
];
const phaseDetails = [
  "Your report is in the queue.",
  "Preparing your confirmed brand context.",
  "Looking for complementary brands and competitors.",
  "Organizing source excerpts and their provenance.",
  "Grouping themes and evaluating relevance.",
  "Ranking opportunities and comparing brands.",
  "Turning evidence into a useful next step.",
];
type Drawer = { title: string; evidenceIds: string[]; candidate?: Candidate };

function BrandArt({
  kind,
  compact = false,
}: {
  kind: string;
  compact?: boolean;
}) {
  return (
    <svg
      className={compact ? "brand-art compact" : "brand-art"}
      viewBox="0 0 220 140"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="110"
        cy="124"
        rx="62"
        ry="7"
        fill="currentColor"
        opacity=".08"
      />
      {kind === "ceramic" ? (
        <>
          <path
            d="M143 63h14c25 0 26 41 0 44h-17"
            stroke="#796891"
            strokeWidth="10"
          />
          <path
            d="M63 55h86l-7 57c-2 17-70 17-72 0z"
            fill="#f8f2e7"
            stroke="#796891"
            strokeWidth="2"
          />
          <ellipse
            cx="106"
            cy="55"
            rx="43"
            ry="10"
            fill="#dfd2c4"
            stroke="#796891"
            strokeWidth="2"
          />
          <ellipse cx="106" cy="56" rx="32" ry="5" fill="#896757" />
          <path
            d="M83 75v23m12-23v32m12-32v35m12-35v32m12-32v23"
            stroke="#d7c8b8"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M96 34c-11-10 9-13 0-25m19 23c-8-9 10-11 2-21"
            stroke="#796891"
            strokeWidth="2"
            strokeLinecap="round"
            opacity=".55"
          />
        </>
      ) : kind === "kettle" ? (
        <>
          <path
            d="M135 54c45-10 57 57 15 55"
            stroke="#655949"
            strokeWidth="10"
          />
          <path
            d="M77 60L52 49 40 24"
            stroke="#667966"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path
            d="M86 49h40l29 57c10 23-91 28-86 0z"
            fill="#82947b"
            stroke="#566e52"
            strokeWidth="2"
          />
          <ellipse cx="107" cy="49" rx="24" ry="5" fill="#bec8a8" />
          <path d="M96 43c-2-14 22-14 22 0" fill="#655949" />
          <path
            d="M98 63l-9 38"
            stroke="#afba99"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      ) : kind === "jar" ? (
        <>
          <path
            d="M82 40h59v10c14 8 12 21 12 33v29c0 15-83 15-83 0V82c0-16 1-26 12-32z"
            fill="#d59a4f"
            stroke="#987344"
            strokeWidth="2"
          />
          <rect
            x="79"
            y="31"
            width="65"
            height="16"
            rx="5"
            fill="#f5ead1"
            stroke="#987344"
            strokeWidth="2"
          />
          <path
            d="M86 35v8m8-8v8m8-8v8m8-8v8m8-8v8m8-8v8m8-8v8"
            stroke="#cdbb94"
          />
          <path d="M72 67h79v39H72z" fill="#fff7dc" />
          <path
            d="M106 76c-12 1-11 16 0 18m9-18c12 1 11 16 0 18"
            stroke="#a1804f"
            strokeWidth="2"
          />
          <path d="M110 72v26" stroke="#a1804f" strokeWidth="2" />
        </>
      ) : kind === "book" ? (
        <>
          <path
            d="M62 41l62-15 42 26v64l-65 15-39-25z"
            fill="#e8e3d4"
            stroke="#607a8d"
            strokeWidth="2"
          />
          <path d="M64 42l39 25 63-15v60l-63 14-39-25z" fill="#7994a6" />
          <path
            d="M103 67v59M68 101l32 20m7-2 54-13"
            stroke="#d5dedc"
            strokeWidth="2"
          />
          <path d="M116 76l35-8m-35 16 25-6" stroke="#f1ead6" strokeWidth="3" />
          <path d="M64 37l38 24 63-15" stroke="#607a8d" strokeWidth="3" />
        </>
      ) : kind === "textile" ? (
        <>
          <path
            d="M65 44l67-12 31 66-77 26-31-18z"
            fill="#eeeadd"
            stroke="#75806b"
            strokeWidth="2"
          />
          <path
            d="M70 48l28 68m-14-72 29 67m-14-70 30 63m-15-66 29 61M61 70l82-21m-81 34 87-23m-81 35 86-23m-81 35 87-25"
            stroke="#abb69e"
            strokeWidth="4"
          />
          <path
            d="M83 126l5-4m3 7 5-5m5 2 4-5m7 2 3-5m7 2 2-5m7 2 2-5m8 2 1-5m8 2v-5"
            stroke="#75806b"
            strokeWidth="2"
          />
        </>
      ) : kind === "bag" ? (
        <>
          <path
            d="M80 31h64l-6 11 17 70c2 16-90 16-88 0l18-70z"
            fill="#e6d6b8"
            stroke="#6e775e"
            strokeWidth="2"
          />
          <path d="M85 42h53" stroke="#6e775e" strokeWidth="3" />
          <path d="M76 65h72v41H76z" fill="#758367" />
          <path
            d="M97 73h31m-31 8h21m-21 17h31"
            stroke="#faf4e7"
            strokeWidth="3"
          />
          <ellipse cx="118" cy="91" rx="5" ry="7" fill="#faf4e7" />
        </>
      ) : (
        <>
          <path
            d="M78 59h66v52c0 20-66 20-66 0z"
            fill="#a3776c"
            stroke="#78584f"
            strokeWidth="2"
          />
          <ellipse
            cx="111"
            cy="59"
            rx="33"
            ry="8"
            fill="#f7ead4"
            stroke="#78584f"
            strokeWidth="2"
          />
          <path d="M111 56v-9" stroke="#78584f" strokeWidth="2" />
          <path d="M111 47c-16-7 0-23 0-23s15 18 0 23" fill="#ecb86e" />
          <rect x="88" y="78" width="45" height="28" rx="1" fill="#f6ead9" />
          <path d="M98 88h25m-21 8h17" stroke="#a3776c" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

function CandidateMedia({ candidate }: { candidate: Candidate }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [candidate.imageUrl]);
  if (candidate.imageUrl && !imageFailed)
    return (
      <>
        <img
          className="website-image"
          src={candidate.imageUrl}
          alt={candidate.imageAlt ?? `${candidate.name} storefront visual`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
        <span className="website-image-label">
          <Globe2 size={12} /> From {candidate.domain}
        </span>
      </>
    );
  return (
    <div className="brand-fallback">
      <BrandArt kind={candidate.mark} />
      <div className={`art-wordmark ${candidate.id}`}>{candidate.name}</div>
      <span className="art-tagline">{candidate.tagline}</span>
    </div>
  );
}

function EcosystemArt() {
  return (
    <svg
      className="ecosystem-art"
      viewBox="0 0 380 215"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M188 114C133 115 133 50 80 53M192 116c42-1 51-65 100-65M188 120c-61 0-37 56-110 55m117-54c54-1 43 57 115 41"
        stroke="#759483"
        strokeWidth="1.5"
        strokeDasharray="4 5"
      />
      <circle cx="191" cy="115" r="41" fill="#ffffff" />
      <circle cx="191" cy="115" r="48" stroke="#a8c2b5" strokeOpacity=".65" />
      <path
        d="M190 139v-40m0 21c-26 0-28-25-28-25s30-3 28 25m0-9c23 0 27-24 27-24s-28 0-27 24"
        stroke="#315d46"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="42"
        y="17"
        width="69"
        height="69"
        rx="20"
        fill="#dcebe3"
        transform="rotate(-12 76 51)"
      />
      <path
        d="M60 41h26v20c0 13-26 13-26 0zm26 3h5c13 0 13 17 0 17h-5"
        stroke="#315c4b"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <rect
        x="269"
        y="22"
        width="62"
        height="62"
        rx="19"
        fill="#c9dfd3"
        transform="rotate(13 300 53)"
      />
      <path
        d="M287 59l25-8m-22 16 25-8m-31-6 25-8m-8-10-17 17 8 24 25-21-8-19z"
        stroke="#315c4b"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <rect
        x="45"
        y="145"
        width="55"
        height="55"
        rx="18"
        fill="#e8f1ec"
        transform="rotate(7 72 172)"
      />
      <path
        d="M66 158h14l6 25H60zm0 0v-4h14v4m-11 10h9"
        stroke="#315c4b"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <rect
        x="286"
        y="134"
        width="64"
        height="64"
        rx="20"
        fill="#d6e7de"
        transform="rotate(-9 318 166)"
      />
      <path
        d="M303 156l15-4 15 4v23l-15-4-15 4zm15-4v23"
        stroke="#315c4b"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M242 27v12m-6-6h12M120 149v10m-5-5h10"
        stroke="#c4dbcf"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="229" cy="185" r="3" fill="#c4dbcf" />
    </svg>
  );
}

function Modal({
  children,
  title,
  close,
  className = "",
}: {
  children: ReactNode;
  title: string;
  close: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab") return;
      const nodes = ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, select, textarea, a[href], [tabindex="0"]',
      );
      if (!nodes?.length) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className={`modal-backdrop ${className}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="modal"
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function App() {
  const [reports, setReports] = useState<Report[]>([]);
  const [reportId, setReportId] = useState("");
  const [nav, setNav] = useState("overview");
  const [tab, setTab] = useState("collaborators");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("fit");
  const [confidence, setConfidence] = useState("all");
  const [saved, setSaved] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [utility, setUtility] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [health, setHealth] = useState<Record<string, string | number>>({});
  const report = reports.find((r) => r.id === reportId) ?? reports[0];
  const refresh = async () => {
    try {
      await api("/session");
      const [nextReports, nextSaved, nextFeedback] = await Promise.all([
        api<Report[]>("/reports"),
        api<string[]>("/saved"),
        api<Record<string, string>>("/feedback"),
      ]);
      setReports(nextReports);
      setSaved(nextSaved);
      setFeedback(nextFeedback);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!report || terminal(report.status)) return;
    const stream = new EventSource(`/v1/reports/${report.id}/events`);
    stream.onmessage = (event) => {
      const next: Report = JSON.parse(event.data);
      setReports((prev) => prev.map((r) => (r.id === next.id ? next : r)));
      if (terminal(next.status)) stream.close();
    };
    stream.onerror = () => {
      setToast("Reconnecting to report progress…");
    };
    return () => stream.close();
  }, [report?.id, report?.status]);
  const switchNav = (value: string) => {
    setNav(value);
    setMobileNav(false);
    setQuery("");
    setConfidence("all");
  };
  const toggleSave = async (id: string) => {
    const wasSaved = saved.includes(id);
    try {
      await api(`/saved/${id}`, { method: wasSaved ? "DELETE" : "PUT" });
      setSaved((prev) =>
        wasSaved ? prev.filter((v) => v !== id) : [...new Set([...prev, id])],
      );
      setToast(
        wasSaved
          ? "Brand removed from your saved list."
          : "A good one to keep. Brand saved.",
      );
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const rate = async (id: string, rating: string) => {
    try {
      await api(`/report-items/${id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ rating }),
      });
      setFeedback((prev) => ({ ...prev, [id]: rating }));
      setToast("Thanks. Your feedback has been recorded.");
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const openEvidence = (
    title: string,
    evidenceIds: string[],
    candidate?: Candidate,
  ) => setDrawer({ title, evidenceIds, candidate });
  const exportReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grove-demo-report-${report.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast("Your demo report has been exported.");
  };
  const savedCandidates = Array.from(
    new Map(
      reports
        .flatMap((r) => [...r.collaborators, ...r.competitors])
        .filter((c) => saved.includes(c.id))
        .map((c) => [c.id, c]),
    ).values(),
  );
  const candidates =
    nav === "saved"
      ? savedCandidates
      : tab === "competitors"
        ? (report?.competitors ?? [])
        : (report?.collaborators ?? []);
  const filtered = candidates
    .filter(
      (c) =>
        `${c.name} ${c.category} ${c.idea}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (confidence === "all" || c.confidence === confidence),
    )
    .sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : b.score - a.score,
    );
  const isRunning = report && !terminal(report.status);

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            switchNav("overview");
          }}
        >
          <span className="logo-symbol">
            <Sprout size={28} strokeWidth={2} />
          </span>
          grove<span className="wordmark-dot">.</span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => setUtility("workspace")}
        >
          <span className="workspace-avatar">
            s<span>•</span>
          </span>
          <span>
            <strong>Sunday studio</strong>
            <small>Your workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={nav === "overview" ? "active" : ""}
            onClick={() => switchNav("overview")}
          >
            <LayoutGrid size={18} />
            Overview
          </button>
          <button
            className={nav === "reports" ? "active" : ""}
            onClick={() => switchNav("reports")}
          >
            <FileText size={18} />
            My reports<span className="nav-count">{reports.length}</span>
          </button>
          <button
            className={nav === "saved" ? "active" : ""}
            onClick={() => switchNav("saved")}
          >
            <Bookmark size={18} />
            Saved brands
            {saved.length > 0 && (
              <span className="nav-count">{saved.length}</span>
            )}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="grow-note">
            <div className="tiny-sprout">
              <Sprout size={23} />
            </div>
            <strong>Good things grow together.</strong>
            <p>Your next great partnership could be one report away.</p>
            <button onClick={() => setShowNew(true)}>
              Explore the possibilities <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="sidebar-utility"
            onClick={() => setUtility("help")}
          >
            <CircleHelp size={18} />A little help
          </button>
          <button
            className="sidebar-utility"
            onClick={() => {
              setUtility("settings");
              void api<Record<string, string | number>>("/health")
                .then(setHealth)
                .catch((e) => setToast(e.message));
            }}
          >
            <Settings2 size={18} />
            Workspace settings
          </button>
          <div className="user-card">
            <span className="user-avatar">S</span>
            <div>
              <strong>Sunday studio</strong>
              <small>Demo workspace</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {nav === "saved"
                ? "Saved brands"
                : nav === "reports"
                  ? "My reports"
                  : "Overview"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="preview-pill">
              <span /> Product preview
            </span>
            <button
              className="icon-button help-top"
              aria-label="About Grove"
              onClick={() => setUtility("help")}
            >
              <CircleHelp size={19} />
            </button>
            <span className="top-avatar">S</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                A LITTLE PERSPECTIVE. A LOT OF POSSIBILITY.
              </div>
              <h1>
                {nav === "saved"
                  ? "The ones to keep."
                  : nav === "reports"
                    ? "Your growing collection."
                    : "Room to grow."}
                <span className="heading-leaf">
                  <Leaf size={25} />
                </span>
              </h1>
              <p>
                {nav === "saved"
                  ? "Good-fit brands, kept close for your next move."
                  : nav === "reports"
                    ? "A fresh perspective on every brand you explore."
                    : "Find your people. Understand your market. Make your next move."}
              </p>
            </div>
            <button
              className="button primary new-report-button"
              onClick={() => setShowNew(true)}
            >
              <Plus size={17} />
              New report
            </button>
          </div>
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" /> Getting your workspace ready…
            </div>
          ) : error ? (
            <div className="empty-state">
              <h2>We couldn’t open your workspace.</h2>
              <p>{error}</p>
              <button className="button primary" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          ) : nav === "reports" ? (
            <>
              <div className="section-header">
                <h2>
                  All reports{" "}
                  <span className="count-pill">{reports.length}</span>
                </h2>
                <span className="muted">
                  Saved automatically in this browser’s workspace
                </span>
              </div>
              <div className="report-list">
                {reports.map((r) => (
                  <button
                    key={r.id}
                    className="report-row"
                    onClick={() => {
                      setReportId(r.id);
                      switchNav("overview");
                      setTab("collaborators");
                    }}
                  >
                    <span className="report-icon">
                      {r.profile.mode === "browserbase" ? (
                        <Compass size={23} />
                      ) : (
                        <Coffee size={23} />
                      )}
                    </span>
                    <span className="report-row-title">
                      <strong>{r.profile.name}</strong>
                      <small>
                        {r.profile.category} ·{" "}
                        {new Date(r.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </small>
                    </span>
                    <span className={`status-pill ${r.status}`}>
                      {r.status}
                    </span>
                    <span className="demo-label">
                      {r.profile.mode === "browserbase" ? "Live" : "Demo"}
                    </span>
                    <ArrowUpRight size={18} />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {nav === "overview" && (
                <>
                  <section className="welcome-banner">
                    <div className="welcome-copy">
                      <span className="banner-eyebrow">
                        <span /> A BIGGER PICTURE FOR YOUR BRAND
                      </span>
                      <h2>
                        Your next chapter
                        <br />
                        starts with a connection.
                      </h2>
                      <p>
                        There’s a whole ecosystem around your store.
                        <br className="desktop-break" /> Let’s find where you
                        fit—and where you could go.
                      </p>
                      <button onClick={() => setShowNew(true)}>
                        Let’s explore <ArrowRight size={16} />
                      </button>
                    </div>
                    <EcosystemArt />
                  </section>
                  {report && (
                    <section className="current-report">
                      <div className="report-context">
                        <div className="store-emblem">
                          {report.profile.mode === "browserbase" ? (
                            <Compass size={22} />
                          ) : (
                            <Coffee size={22} />
                          )}
                        </div>
                        <div>
                          <div className="store-name">
                            {report.profile.name}
                            <span className="demo-label">
                              {report.profile.mode === "browserbase"
                                ? "Live research"
                                : "Demo report"}
                            </span>
                          </div>
                          <div className="store-meta">
                            {report.profile.category}
                            <span>·</span>
                            {report.profile.geography}
                            <span className="meta-date">
                              · Updated{" "}
                              {new Date(report.updatedAt).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" },
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        className="button subtle small"
                        onClick={exportReport}
                      >
                        <ArrowDownToLine size={15} />
                        Export report
                      </button>
                    </section>
                  )}
                  <div className="demo-notice">
                    {report?.profile.mode === "browserbase" ? (
                      <Globe2 size={14} />
                    ) : (
                      <FlaskConical size={14} />
                    )}
                    <span>
                      {report?.profile.mode === "browserbase"
                        ? "Candidates and evidence were captured from live public storefronts. Rankings are research leads, not verified relationships."
                        : "Meet the possibilities. This sample uses fictional brands and illustrative evidence."}
                    </span>
                    <button onClick={() => setUtility("demo")}>
                      About this data <ArrowUpRight size={12} />
                    </button>
                  </div>
                  {isRunning && (
                    <section className="progress-panel" aria-live="polite">
                      <div className="progress-heading">
                        <div>
                          <span className="eyebrow">
                            {report.profile.mode === "browserbase"
                              ? "LIVE RESEARCH IN PROGRESS"
                              : "DEMO RESEARCH IN PROGRESS"}
                          </span>
                          <h2>{phaseLabels[phases.indexOf(report.phase)]}</h2>
                          <p>{phaseDetails[phases.indexOf(report.phase)]}</p>
                        </div>
                        <LoaderCircle className="spin" size={28} />
                      </div>
                      <div className="progress-track">
                        {phases.map((phase, i) => (
                          <span
                            className={
                              i <= phases.indexOf(report.phase) ? "done" : ""
                            }
                            key={phase}
                          />
                        ))}
                      </div>
                      <div className="progress-foot">
                        <span>
                          {report.profile.mode === "browserbase"
                            ? "Live storefront research · five-minute maximum"
                            : `Step ${phases.indexOf(report.phase) + 1} of ${phases.length} · simulated pipeline`}
                        </span>
                        <button
                          onClick={async () => {
                            try {
                              const next = await api<Report>(
                                `/reports/${report.id}/cancel`,
                                { method: "POST" },
                              );
                              setReports((prev) =>
                                prev.map((r) => (r.id === next.id ? next : r)),
                              );
                            } catch (e) {
                              setToast((e as Error).message);
                            }
                          }}
                        >
                          Cancel report
                        </button>
                      </div>
                    </section>
                  )}
                  {report?.warning && (
                    <div className="warning-notice">
                      <CircleHelp size={18} />
                      <span>{report.warning}</span>
                    </div>
                  )}
                  {report?.status === "cancelled" && (
                    <div className="warning-notice">
                      <span>
                        Report cancelled. Any completed results are kept below.
                      </span>
                      <button onClick={() => setShowNew(true)}>
                        Start a new report <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                  <div
                    className="report-tabs"
                    role="tablist"
                    aria-label="Report sections"
                  >
                    {[
                      {
                        id: "collaborators",
                        label: "Collaborators",
                        icon: Users,
                        count: report?.collaborators.length ?? 0,
                      },
                      {
                        id: "competitors",
                        label: "Competitors & discourse",
                        icon: Compass,
                        count: report?.competitors.length ?? 0,
                      },
                      { id: "swot", label: "SWOT & next steps", icon: Target },
                    ].map(({ id, label, icon: Icon, count }) => (
                      <button
                        key={id}
                        role="tab"
                        id={`tab-${id}`}
                        aria-controls="report-panel"
                        aria-selected={tab === id}
                        tabIndex={tab === id ? 0 : -1}
                        onKeyDown={(e) => {
                          if (!["ArrowLeft", "ArrowRight"].includes(e.key))
                            return;
                          e.preventDefault();
                          const ids = ["collaborators", "competitors", "swot"];
                          const next =
                            ids[
                              (ids.indexOf(id) +
                                (e.key === "ArrowRight" ? 1 : 2)) %
                                3
                            ];
                          setTab(next);
                          document.getElementById(`tab-${next}`)?.focus();
                        }}
                        className={tab === id ? "selected" : ""}
                        onClick={() => {
                          setTab(id);
                          setQuery("");
                          setConfidence("all");
                        }}
                      >
                        <Icon size={17} />
                        {label}
                        {count !== undefined && <span>{count}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div
                id="report-panel"
                role={nav === "overview" ? "tabpanel" : undefined}
                aria-labelledby={nav === "overview" ? `tab-${tab}` : undefined}
              >
                {tab === "swot" && nav === "overview" ? (
                  <>
                    <div className="section-header">
                      <div>
                        <h2>A clearer way forward</h2>
                        <p>
                          Your brand, the bigger picture, and a few smart next
                          steps.
                        </p>
                      </div>
                      <span className="inference-tag">
                        <Sparkles size={13} /> Inferences labeled
                      </span>
                    </div>
                    {report?.swot.strengths.length ? (
                      <>
                        <div className="swot-grid">
                          {Object.entries(report.swot).map(
                            ([quadrant, items]) => (
                              <section
                                className={`swot-card ${quadrant}`}
                                key={quadrant}
                              >
                                <div className="swot-heading">
                                  <span>
                                    {quadrant === "strengths" ? (
                                      <Sprout />
                                    ) : quadrant === "weaknesses" ? (
                                      <SlidersHorizontal />
                                    ) : quadrant === "opportunities" ? (
                                      <Sparkles />
                                    ) : (
                                      <ShieldCheck />
                                    )}
                                  </span>
                                  <div>
                                    <h3>{quadrant}</h3>
                                    <small>
                                      {["strengths", "weaknesses"].includes(
                                        quadrant,
                                      )
                                        ? "Inside your brand"
                                        : "In your market"}
                                    </small>
                                  </div>
                                </div>
                                {items.map((item) => (
                                  <button
                                    className="swot-item"
                                    key={item.id}
                                    onClick={() =>
                                      openEvidence(item.title, item.evidenceIds)
                                    }
                                  >
                                    <strong>
                                      {item.title}
                                      <ArrowUpRight size={14} />
                                    </strong>
                                    <p>{item.description}</p>
                                    <span>
                                      {item.claimType} ·{" "}
                                      {item.confidence.toLowerCase()} confidence
                                      · {item.evidenceIds.length} sources
                                    </span>
                                  </button>
                                ))}
                              </section>
                            ),
                          )}
                        </div>
                        <section className="next-steps">
                          <div className="section-header">
                            <div>
                              <span className="eyebrow">
                                SMALL STEPS. REAL LEARNING.
                              </span>
                              <h2>Put your perspective to work.</h2>
                            </div>
                            <Sprout size={28} />
                          </div>
                          {report.actions.map((a, i) => (
                            <div className="action-row" key={a.title}>
                              <span className="action-number">0{i + 1}</span>
                              <div>
                                <h3>{a.title}</h3>
                                <p>{a.experiment}</p>
                                <span>{a.effort} · proposed experiment</span>
                              </div>
                              <button
                                className="icon-button"
                                aria-label={`Evidence for ${a.title}`}
                                onClick={() =>
                                  openEvidence(a.title, a.evidenceIds)
                                }
                              >
                                <ArrowUpRight size={18} />
                              </button>
                            </div>
                          ))}
                        </section>
                      </>
                    ) : (
                      <Empty
                        title={
                          isRunning
                            ? "Your strategy is taking shape."
                            : "Strategy needs a little more evidence."
                        }
                        text={
                          isRunning
                            ? "The final synthesis will appear here when this demo run finishes."
                            : "Start a complete demo report to explore the SWOT and recommended experiments."
                        }
                      />
                    )}
                  </>
                ) : (
                  <>
                    <div className="section-header discovery-heading">
                      <div>
                        <h2>
                          {nav === "saved"
                            ? "Your shortlist"
                            : tab === "competitors"
                              ? "Know your neighborhood."
                              : "Better, together."}
                          <span className="count-pill">
                            {candidates.length}
                          </span>
                        </h2>
                        <p>
                          {nav === "saved"
                            ? "Keep the promising connections in one place."
                            : tab === "competitors"
                              ? "Understand who’s nearby—and what people are saying."
                              : "Complementary brands. Shared audiences. A little mutual magic."}
                        </p>
                      </div>
                      <span className="ranking-note">
                        <SlidersHorizontal size={14} />
                        {nav === "saved"
                          ? "Your collection"
                          : "Ranked by strategic fit"}
                      </span>
                    </div>
                    <div className="filter-row">
                      <label className="search-field">
                        <Search size={16} />
                        <input
                          aria-label="Search brands"
                          placeholder="Find a brand or category…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                          <button
                            className="icon-button"
                            aria-label="Clear search"
                            onClick={() => setQuery("")}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </label>
                      <div className="filter-controls">
                        <label className="filter-select">
                          <SlidersHorizontal size={14} />
                          <select
                            aria-label="Filter confidence"
                            value={confidence}
                            onChange={(e) => setConfidence(e.target.value)}
                          >
                            <option value="all">All confidence</option>
                            <option value="High">High confidence</option>
                            <option value="Medium">Medium confidence</option>
                          </select>
                          <ChevronDown size={13} />
                        </label>
                        <label className="filter-select sort-select">
                          <span>Sort:</span>
                          <select
                            aria-label="Sort brands"
                            value={sort}
                            onChange={(e) => setSort(e.target.value)}
                          >
                            <option value="fit">Best fit</option>
                            <option value="name">A–Z</option>
                          </select>
                          <ChevronDown size={13} />
                        </label>
                      </div>
                    </div>
                    {filtered.length ? (
                      <div className="brand-grid">
                        {filtered.map((c) => (
                          <article className="brand-card" key={c.id}>
                            <div
                              className={`brand-visual ${c.imageUrl ? "has-website-image" : "fallback-visual"}`}
                            >
                              <span className="category-pill">
                                {c.category}
                              </span>
                              <button
                                aria-label={`${saved.includes(c.id) ? "Unsave" : "Save"} ${c.name}`}
                                aria-pressed={saved.includes(c.id)}
                                className={`save-button ${saved.includes(c.id) ? "is-saved" : ""}`}
                                onClick={() => void toggleSave(c.id)}
                              >
                                <Bookmark
                                  size={17}
                                  fill={
                                    saved.includes(c.id)
                                      ? "currentColor"
                                      : "none"
                                  }
                                />
                              </button>
                              <CandidateMedia candidate={c} />
                            </div>
                            <div className="brand-content">
                              <div className="brand-title-row">
                                <h3>{c.name}</h3>
                                <span className="fit-score">
                                  <span />
                                  {c.score}
                                  <small>fit</small>
                                </span>
                              </div>
                              <div className="brand-subline">
                                {c.type
                                  ? `${c.type[0].toUpperCase()}${c.type.slice(1)} competitor`
                                  : "Complementary brand"}
                                <span>·</span>
                                {c.confidence} confidence
                              </div>
                              <p className="brand-reason">{c.reason}</p>
                              <button
                                className="idea-box"
                                onClick={() =>
                                  openEvidence(c.name, c.evidenceIds, c)
                                }
                              >
                                <Sparkles size={16} />
                                <span>
                                  <small>
                                    {c.type
                                      ? "A SPACE TO EXPLORE"
                                      : "A LITTLE COLLAB INSPIRATION"}
                                  </small>
                                  <strong>{c.idea}</strong>
                                </span>
                                <ArrowUpRight size={16} />
                              </button>
                              <div className="brand-footer">
                                <button
                                  onClick={() =>
                                    openEvidence(c.name, c.evidenceIds, c)
                                  }
                                >
                                  <Link2 size={14} />
                                  {c.evidenceIds.length} sample sources
                                </button>
                                <button
                                  className="view-match"
                                  onClick={() =>
                                    openEvidence(c.name, c.evidenceIds, c)
                                  }
                                >
                                  Explore <ArrowRight size={14} />
                                </button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title={
                          query || confidence !== "all"
                            ? "No matches just yet."
                            : nav === "saved"
                              ? "Make a little room for the good ones."
                              : isRunning
                                ? "Good connections take a moment."
                                : "No brands in this section yet."
                        }
                        text={
                          query || confidence !== "all"
                            ? "Try another search or choose all confidence levels."
                            : nav === "saved"
                              ? "Tap the bookmark on any brand to start your shortlist."
                              : "Your available results will appear here as the report progresses."
                        }
                      />
                    )}
                    {tab === "competitors" &&
                      nav === "overview" &&
                      !!report?.themes.length && (
                        <section className="discourse-section">
                          <div className="section-header">
                            <div>
                              <h2>Around the conversation</h2>
                              <p>
                                A small sample of signals, with the gaps kept in
                                view.
                              </p>
                            </div>
                            <MessageCircle size={23} />
                          </div>
                          <div className="theme-grid">
                            {report.themes.map((theme) => (
                              <button
                                key={theme.id}
                                className={`theme-card ${theme.id}`}
                                onClick={() =>
                                  openEvidence(theme.title, theme.evidenceIds)
                                }
                              >
                                <span className="theme-kind">{theme.kind}</span>
                                <h3>{theme.title}</h3>
                                <p>{theme.description}</p>
                                <span className="theme-foot">
                                  {theme.mentions
                                    ? `${theme.mentions} fictional comments · Sep 16–18`
                                    : "Insufficient evidence"}
                                  <ArrowUpRight size={15} />
                                </span>
                              </button>
                            ))}
                          </div>
                          <p className="sampling-note">
                            Illustrative comments are not a representative
                            sample or a measure of market share.
                          </p>
                        </section>
                      )}
                  </>
                )}
              </div>
              <footer className="page-footer">
                <span>
                  <Sprout size={15} />A little more clarity. A little more
                  possibility.
                </span>
                <span>Made for brands with somewhere to grow.</span>
              </footer>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div role="status" className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
      {showNew && (
        <NewReport
          close={() => setShowNew(false)}
          onCreated={(next) => {
            setReports((prev) => [next, ...prev]);
            setReportId(next.id);
            setTab("collaborators");
            switchNav("overview");
            setShowNew(false);
          }}
        />
      )}
      {drawer && (
        <Modal
          title={drawer.title}
          close={() => setDrawer(null)}
          className="drawer-backdrop"
        >
          <div className="drawer-content">
            <span className="demo-label">
              {report?.profile.mode === "browserbase"
                ? "Live captured evidence"
                : "Illustrative demo evidence"}
            </span>
            {drawer.candidate && (
              <>
                <div
                  className={`drawer-art ${drawer.candidate.imageUrl ? "has-website-image" : "fallback-visual"}`}
                >
                  <CandidateMedia candidate={drawer.candidate} />
                </div>
                <div className="drawer-section">
                  <span className="eyebrow">WHY THIS CONNECTION</span>
                  <h3>{drawer.candidate.idea}</h3>
                  <p>{drawer.candidate.reason}</p>
                </div>
                <div className="drawer-section">
                  <h3>What goes into the fit?</h3>
                  <p className="muted">
                    Ranking aid, not a probability. Values prioritize research
                    leads and do not establish a relationship.
                  </p>
                  {drawer.candidate.components.map((c) => (
                    <div className="score-component" key={c.label}>
                      <span>
                        {c.label}
                        <small>{c.weight}% weight</small>
                      </span>
                      <div>
                        <i style={{ width: `${c.score}%` }} />
                      </div>
                      <strong>{c.score}</strong>
                    </div>
                  ))}
                </div>
                <div className="caveat">
                  <ShieldCheck size={19} />
                  <p>{drawer.candidate.caveat}</p>
                </div>
              </>
            )}
            <section className="drawer-section">
              <h3>
                The evidence trail{" "}
                <span className="count-pill">{drawer.evidenceIds.length}</span>
              </h3>
              <p className="muted">
                Source excerpts stay attached to the claim they support.
              </p>
              {drawer.evidenceIds.length ? (
                drawer.evidenceIds.map((id) => {
                  const ev =
                    report?.evidence.find((e) => e.id === id) ??
                    reports.flatMap((r) => r.evidence).find((e) => e.id === id);
                  return ev ? (
                    <EvidenceCard key={id} evidence={ev} />
                  ) : (
                    <div key={id} className="warning-notice">
                      Source {id} is unavailable. This claim cannot be verified.
                    </div>
                  );
                })
              ) : (
                <div className="evidence-gap">
                  There are no supporting sources for this theme. It is shown as
                  a research gap, not a conclusion.
                </div>
              )}
            </section>
            {drawer.candidate && (
              <div className="drawer-actions">
                <button
                  className="button primary"
                  onClick={() => void toggleSave(drawer.candidate!.id)}
                >
                  <Bookmark size={16} />
                  {saved.includes(drawer.candidate.id)
                    ? "Remove saved brand"
                    : "Save this brand"}
                </button>
                <div className="feedback">
                  <span>Useful?</span>
                  <button
                    aria-label="Mark useful"
                    aria-pressed={feedback[drawer.candidate.id] === "useful"}
                    className="icon-button"
                    onClick={() => void rate(drawer.candidate!.id, "useful")}
                  >
                    <ThumbsUp size={17} />
                  </button>
                  <button
                    aria-label="Mark not useful"
                    aria-pressed={
                      feedback[drawer.candidate.id] === "not_useful"
                    }
                    className="icon-button"
                    onClick={() =>
                      void rate(drawer.candidate!.id, "not_useful")
                    }
                  >
                    <ThumbsDown size={17} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
      {utility && (
        <Modal
          title={
            utility === "settings"
              ? "Your workspace"
              : utility === "workspace"
                ? "A place to grow"
                : utility === "demo"
                  ? "A note about this demo"
                  : "A little help from Grove"
          }
          close={() => setUtility("")}
        >
          <div className="utility-content">
            {utility === "settings" ? (
              <>
                <p>
                  This private demo workspace is tied to your browser session.
                  Reports, saved brands, and feedback are stored locally by the
                  platform API.
                </p>
                <div className="settings-card">
                  <span>Workspace</span>
                  <strong>Sunday studio</strong>
                  <span>Research mode</span>
                  <strong>
                    {health.providerMode === "browserbase"
                      ? "Live Browserbase"
                      : "Deterministic demo"}
                  </strong>
                  <span>Storage</span>
                  <strong>Local SQLite</strong>
                  <span>API status</span>
                  <strong>{health.status ?? "Checking…"}</strong>
                  <span>Running reports</span>
                  <strong>{health.running ?? "—"}</strong>
                  <span>Completed / partial</span>
                  <strong>
                    {health.completed ?? "—"} / {health.partial ?? "—"}
                  </strong>
                </div>
                <p className="muted">
                  Team sign-in, production Postgres, customer discourse, and
                  deployment are integration work still to come.
                </p>
              </>
            ) : utility === "workspace" ? (
              <>
                <div className="utility-illustration">
                  <Sprout size={50} />
                </div>
                <p>
                  You’re in <strong>Sunday studio</strong>, your local demo
                  workspace. Each browser session gets its own reports and saved
                  brands.
                </p>
                <p className="muted">
                  Team invitations and account switching will be available when
                  authentication is connected.
                </p>
              </>
            ) : utility === "demo" ? (
              report?.profile.mode === "browserbase" ? (
                <>
                  <p>
                    This report uses public storefront pages captured through
                    Browserbase. Product imagery is loaded from the source
                    websites and labeled with its domain.
                  </p>
                  <p>
                    Live research stops after five minutes and keeps supported
                    partial results. A footwear store will not receive another
                    footwear assortment as a collaborator; care and accessory
                    specialists are the limited exception.
                  </p>
                  <p>
                    Fit scores prioritize leads for review. They do not confirm
                    a partnership, audience match, or competitive relationship.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    All brands, scores, comments, and source excerpts in this
                    preview are fictional. They demonstrate how a real
                    evidence-backed report will work.
                  </p>
                  <p>
                    New demo reports use category-aware fixtures. Your store URL
                    is saved as context; it is not fetched or analyzed.
                  </p>
                  <p>
                    Sample sources deliberately have no external links. Live
                    research supplies captured source URLs, dates, exact
                    excerpts, and available storefront imagery.
                  </p>
                </>
              )
            ) : (
              <>
                <p>
                  Grove helps Shopify brands find complementary collaborators,
                  understand their competitors, and decide what to try next.
                </p>
                <ol className="help-steps">
                  <li>
                    <strong>Start with your store.</strong> Add a URL and review
                    your brand context.
                  </li>
                  <li>
                    <strong>Explore your ecosystem.</strong> Compare
                    opportunities and open the evidence behind each match.
                  </li>
                  <li>
                    <strong>Keep the good ones.</strong> Save brands, leave
                    feedback, and turn strategy into a small experiment.
                  </li>
                </ol>
                <div className="caveat">
                  {report?.profile.mode === "browserbase" ? (
                    <Globe2 size={22} />
                  ) : (
                    <FlaskConical size={22} />
                  )}
                  <p>
                    {report?.profile.mode === "browserbase"
                      ? "Live storefront research is connected. Customer discourse and production identity still need integration."
                      : "You’re exploring the deterministic demo. Switch PROVIDER_MODE to browserbase to research public storefronts."}
                  </p>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function EvidenceCard({ evidence }: { evidence: Evidence }) {
  return (
    <article className="evidence-card">
      <div>
        <span>{evidence.sourceType}</span>
        <small>
          {new Date(`${evidence.publishedAt}T12:00:00`).toLocaleDateString(
            undefined,
            { month: "short", day: "numeric", year: "numeric" },
          )}
        </small>
      </div>
      <h4>{evidence.title}</h4>
      <blockquote>{evidence.span}</blockquote>
      {evidence.url ? (
        <a href={evidence.url} target="_blank" rel="noopener noreferrer">
          Open source <ExternalLink size={13} />
        </a>
      ) : (
        <span className="evidence-demo">
          <FlaskConical size={13} />
          Fictional source · no external page
        </span>
      )}
    </article>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Sprout size={30} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function NewReport({
  close,
  onCreated,
}: {
  close: () => void;
  onCreated: (r: Report) => void;
}) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [values, setValues] = useState({
    name: "",
    url: "",
    category: "Specialty coffee",
    audience: "Thoughtful home brewers",
    geography: "North America",
    goal: "Find complementary brand partnerships",
  });
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (step === 0) {
        const next = await api<Profile>("/store-profiles", {
          method: "POST",
          body: JSON.stringify(values),
        });
        setProfile(next);
        setValues({
          name: next.name,
          url: next.url,
          category: next.category,
          audience: next.audience,
          geography: next.geography,
          goal: next.goal,
        });
        setStep(1);
      } else {
        await api(`/store-profiles/${profile!.id}`, {
          method: "PATCH",
          body: JSON.stringify(values),
        });
        const report = await api<Report>("/reports", {
          method: "POST",
          headers: { "Idempotency-Key": key.current },
          body: JSON.stringify({
            profileId: profile!.id,
            simulatePartial: partial,
          }),
        });
        onCreated(report);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={step === 0 ? "Let’s meet your brand." : "Does this feel like you?"}
      close={close}
    >
      <form className="new-report-form" onSubmit={(e) => void submit(e)}>
        <div className="wizard-steps">
          <span className="current">
            1 <small>Your store</small>
          </span>
          <i />
          <span className={step === 1 ? "current" : ""}>
            2 <small>Brand profile</small>
          </span>
        </div>
        <p>
          {step === 0
            ? "A little context opens up a whole world of possibilities."
            : "Review your brand context before research begins. You can edit every field below."}
        </p>
        <div className="form-demo-note">
          {profile?.mode === "browserbase" ? (
            <ShieldCheck size={18} />
          ) : (
            <FlaskConical size={18} />
          )}
          <span>
            {profile?.mode === "browserbase"
              ? `Browserbase visited ${profile.research?.pagesVisited ?? 0} storefront pages and found ${profile.research?.shopifyConfidence ?? 0}% Shopify confidence. Review every suggested field before continuing.`
              : profile
                ? "This demo uses a fictional coffee-market report. In demo mode, your URL is not crawled and no store facts are inferred."
                : "Your configured provider will prepare an editable brand profile after you submit the store URL."}
          </span>
        </div>
        {step === 0 ? (
          <>
            <label>
              Brand name
              <input
                required
                maxLength={80}
                autoComplete="organization"
                placeholder="e.g. Sunday Supply"
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
            </label>
            <label>
              Store URL
              <div className="input-icon">
                <Globe2 size={17} />
                <input
                  required
                  maxLength={2048}
                  placeholder="your-store.com"
                  value={values.url}
                  onChange={(e) =>
                    setValues({ ...values, url: e.target.value })
                  }
                />
              </div>
            </label>
            <label>
              What would you like to explore?
              <select
                value={values.goal}
                onChange={(e) => setValues({ ...values, goal: e.target.value })}
              >
                <option>Find complementary brand partnerships</option>
                <option>Understand my competitors</option>
                <option>Find my next growth opportunity</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              Brand name
              <input
                required
                maxLength={80}
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
            </label>
            <div className="form-columns">
              <label>
                Product category
                <input
                  required
                  maxLength={120}
                  value={values.category}
                  onChange={(e) =>
                    setValues({ ...values, category: e.target.value })
                  }
                />
              </label>
              <label>
                Target market
                <input
                  required
                  maxLength={80}
                  value={values.geography}
                  onChange={(e) =>
                    setValues({ ...values, geography: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Your audience
              <textarea
                required
                maxLength={240}
                rows={2}
                value={values.audience}
                onChange={(e) =>
                  setValues({ ...values, audience: e.target.value })
                }
              />
            </label>
            <label>
              Growth goal
              <textarea
                required
                maxLength={240}
                rows={2}
                value={values.goal}
                onChange={(e) => setValues({ ...values, goal: e.target.value })}
              />
            </label>
            {profile?.mode === "demo" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={partial}
                  onChange={(e) => setPartial(e.target.checked)}
                />
                <span>
                  Try a partial report
                  <small>
                    Simulate a source failure to see how completed results are
                    preserved.
                  </small>
                </span>
              </label>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          {step === 1 ? (
            <button
              disabled={busy}
              type="button"
              className="button subtle"
              onClick={() => {
                setStep(0);
                key.current = crypto.randomUUID();
              }}
            >
              <ArrowLeft size={15} />
              Back
            </button>
          ) : (
            <span>
              <ShieldCheck size={14} />
              No Shopify installation needed
            </span>
          )}
          <button className="button primary" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={16} /> : null}
            {step === 0
              ? "Review brand profile"
              : profile?.mode === "browserbase"
                ? "Confirm & start live research"
                : "Confirm & start demo"}
            {!busy && <ArrowRight size={15} />}
          </button>
        </div>
      </form>
    </Modal>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
