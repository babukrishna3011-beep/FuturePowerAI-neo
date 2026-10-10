#!/usr/bin/env python3
"""
FuturePowerAIPlus — final compact education knowledge-base builder.

Creates ONE SQLite + FTS5 database:
    education.db

Target:
    ~300 MB maximum on-disk main DB file

Recommended source layout:
    raw/<source>/<exam>/<class>/<subject>/<file>

Examples:
    raw/ncert/cbse/10/science/science.pdf
    raw/ncert/cbse/10/mathematics/ch01.pdf
    raw/nta/jee/12/physics/syllabus.pdf
    raw/nta/neet/12/biology/biology.pdf
    raw/open/reference/all/computing/mdn.md

Supported:
    PDF, TXT, MD, JSON, JSONL

Commands:
    python build_edu_db_FINAL_300MB.py ingest
    python build_edu_db_FINAL_300MB.py wiki
    python build_edu_db_FINAL_300MB.py repos
    python build_edu_db_FINAL_300MB.py finish
    python build_edu_db_FINAL_300MB.py search "quadratic equations"
    python build_edu_db_FINAL_300MB.py stats
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import re
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DB = "education.db"
RAW = "raw"
CHUNK = 1200
MAX_BYTES = 300_000_000
RESERVE_BYTES = 10_000_000
WIKI_API = "https://en.wikipedia.org/w/api.php"

# Keep Wikipedia as selected general/reference knowledge.
WIKI_QUOTA_MB = {
    "physics": 25,
    "astronomy": 15,
    "chemistry": 25,
    "biology": 30,
    "mathematics": 20,
    "computing": 30,
    "earth": 10,
    "india": 20,
    "world": 20,
}

WIKI_CATEGORIES = {
    "physics": [
        ("Physics", 2), ("Particle physics", 2), ("Quantum mechanics", 2),
        ("Classical mechanics", 2), ("Thermodynamics", 2),
        ("Electromagnetism", 2), ("Optics", 2), ("Nuclear physics", 2),
    ],
    "astronomy": [
        ("Astronomy", 2), ("Astrophysics", 2), ("Cosmology", 2),
        ("Solar System", 2), ("Stars", 2), ("Galaxies", 2),
        ("Black holes", 2), ("Space exploration", 2),
    ],
    "chemistry": [
        ("Chemistry", 2), ("Organic chemistry", 2), ("Inorganic chemistry", 2),
        ("Physical chemistry", 2), ("Named reactions", 2),
        ("Electrochemistry", 2), ("Chemical kinetics", 2), ("Spectroscopy", 2),
    ],
    "biology": [
        ("Biology", 2), ("Molecular biology", 2), ("Genetics", 2),
        ("Biochemistry", 2), ("Cell biology", 2), ("Ecology", 2),
        ("Human anatomy", 2), ("Evolutionary biology", 2),
    ],
    "mathematics": [
        ("Mathematics", 2), ("Calculus", 2), ("Linear algebra", 2),
        ("Number theory", 2), ("Probability theory", 2),
        ("Geometry", 2), ("Combinatorics", 2), ("Statistics", 2),
    ],
    "computing": [
        ("Computer science", 2), ("Algorithms", 2), ("Data structures", 2),
        ("Programming languages", 2), ("Software engineering", 2),
        ("Machine learning", 2), ("Computer networking", 2),
        ("Operating systems", 2), ("Artificial intelligence", 2),
    ],
    "earth": [
        ("Earth sciences", 2), ("Geology", 2), ("Meteorology", 2),
        ("Oceanography", 2), ("Climate change", 2), ("Natural disasters", 2),
    ],
    "india": [
        ("India", 2), ("History of India", 2), ("Geography of India", 2),
        ("States and union territories of India", 2),
        ("Indian independence movement", 2), ("Constitution of India", 2),
        ("Culture of India", 2), ("Economy of India", 2),
    ],
    "world": [
        ("World history", 2), ("Physical geography", 2), ("Economics", 2),
        ("International organizations", 2), ("Human geography", 2),
        ("History of science", 2), ("Philosophy", 1),
    ],
}

WIKI_MUST = {
    "physics": [
        "Particle accelerator", "Cyclotron", "Synchrotron",
        "Large Hadron Collider", "Standard Model", "Quantum chromodynamics",
        "Bose–Einstein condensate", "Superconductivity", "Tokamak",
        "Maxwell's equations", "Schrödinger equation",
        "Lagrangian mechanics", "Hamiltonian mechanics",
    ],
    "chemistry": [
        "Hammett acidity function", "Hard and soft acids and bases",
        "Crystal field theory", "Ligand field theory",
        "Molecular orbital theory", "Marcus theory",
        "Woodward–Hoffmann rules", "Transition state theory",
        "Hückel method", "Density functional theory",
    ],
    "biology": [
        "CRISPR", "Polymerase chain reaction", "Lac operon",
        "Hardy–Weinberg principle", "Oxidative phosphorylation",
        "Action potential",
    ],
    "astronomy": [
        "Chandrasekhar limit", "Hertzsprung–Russell diagram",
        "Hubble's law", "Cosmic microwave background",
        "Dark matter", "Dark energy", "Gravitational wave",
        "Chandrayaan-3", "Aditya-L1", "Event Horizon Telescope",
    ],
    "mathematics": [
        "Fourier transform", "Laplace transform", "Group theory",
        "Riemann hypothesis",
    ],
    "computing": [
        "PEP 8", "SOLID", "Big O notation",
        "Transformer (deep learning architecture)", "Git", "SQL",
        "TCP/IP", "REST",
    ],
}

OPEN_REPOS = [
    ("https://github.com/python/cpython", "Doc", "coding-python", (".rst", ".md")),
    ("https://github.com/python/peps", "peps", "coding-python", (".rst", ".txt")),
    ("https://github.com/mdn/content", "files/en-us", "coding-web", (".md",)),
    ("https://github.com/rust-lang/book", "src", "coding-rust", (".md",)),
    ("https://github.com/rust-lang/rust-by-example", "src", "coding-rust", (".md",)),
    ("https://github.com/google/styleguide", "", "coding-style", (".md",)),
    ("https://github.com/factbook/factbook.json", "", "world-factbook", (".json",)),
]

STOP = set(
    "a an the is are was were of in on at to for and or what why how when where "
    "who which does do did explain define tell me about with by from as it this "
    "that be can you give".split()
)


def connect() -> sqlite3.Connection:
    c = sqlite3.connect(DB)
    c.executescript(
        """
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA temp_store=MEMORY;
        PRAGMA page_size=4096;

        CREATE TABLE IF NOT EXISTS documents(
            id INTEGER PRIMARY KEY,
            source TEXT,
            exam TEXT,
            class TEXT,
            subject TEXT,
            topic TEXT,
            path TEXT UNIQUE
        );

        CREATE TABLE IF NOT EXISTS chunks(
            id INTEGER PRIMARY KEY,
            h TEXT UNIQUE,
            document_id INTEGER,
            source TEXT,
            exam TEXT,
            class TEXT,
            subject TEXT,
            topic TEXT,
            page INTEGER,
            content_type TEXT,
            text TEXT,
            FOREIGN KEY(document_id) REFERENCES documents(id)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
            text,
            topic,
            subject,
            exam,
            class,
            content='chunks',
            content_rowid='id',
            tokenize='porter unicode61',
            detail=column
        );

        CREATE TABLE IF NOT EXISTS done(
            title TEXT PRIMARY KEY
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_filters
        ON chunks(exam, class, subject, topic);
        """
    )
    return c


def db_bytes() -> int:
    return os.path.getsize(DB) if os.path.exists(DB) else 0


def capacity_ok(extra_estimate=0) -> bool:
    return db_bytes() + extra_estimate < (MAX_BYTES - RESERVE_BYTES)


def clean(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"-\n(?=[A-Za-z])", "", text)
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r"(?m)^\s*=+\s*(.*?)\s*=+\s*$", r"\1", text)
    text = re.sub(r"(?im)^\s*(page\s*)?\d+\s*$", "", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def text_chunks(text: str, n: int = CHUNK):
    buf = ""
    for para in text.splitlines():
        para = para.strip()
        if not para:
            continue
        if len(buf) + len(para) + 1 > n and buf:
            yield buf.strip()
            buf = ""
        buf += para + " "
    if buf.strip():
        yield buf.strip()


def hash_chunk(exam, cls, subject, topic, page, text):
    basis = "\n".join(
        [str(exam), str(cls), str(subject), str(topic), str(page), text.lower()]
    )
    return hashlib.blake2b(basis.encode("utf-8"), digest_size=16).hexdigest()


def flat_json(obj, prefix=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from flat_json(v, f"{prefix} {k}".strip())
    elif isinstance(obj, list):
        for v in obj:
            yield from flat_json(v, prefix)
    elif obj not in (None, ""):
        yield f"{prefix}: {obj}"


def read_structured(path: str):
    p = Path(path)
    suffix = p.suffix.lower()

    if suffix == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(str(p))
        for page_no, page in enumerate(reader.pages, start=1):
            yield page_no, "text", clean(page.extract_text() or "")
        return

    if suffix == ".json":
        obj = json.loads(p.read_text(encoding="utf-8", errors="ignore"))
        yield None, "json", clean("\n".join(flat_json(obj)))
        return

    if suffix == ".jsonl":
        out = []
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            try:
                d = json.loads(line)
            except Exception:
                continue
            if isinstance(d, dict) and "abstract" in d:
                out.append(f"{d.get('title', '')}. {d.get('abstract', '')}")
            else:
                out.extend(flat_json(d))
        yield None, "jsonl", clean("\n".join(out))
        return

    yield None, "text", clean(
        p.read_text(encoding="utf-8", errors="ignore")
    )


def ensure_document(c, source, exam, cls, subject, topic, rel_path):
    row = c.execute(
        "SELECT id FROM documents WHERE path=?", (rel_path,)
    ).fetchone()
    if row:
        return row[0]
    cur = c.execute(
        """
        INSERT INTO documents(source,exam,class,subject,topic,path)
        VALUES(?,?,?,?,?,?)
        """,
        (source, exam, cls, subject, topic, rel_path),
    )
    return cur.lastrowid


def add_document(c, source, exam, cls, subject, topic, path):
    if not capacity_ok():
        return 0

    rel_path = os.path.relpath(path, RAW)
    doc_id = ensure_document(
        c, source, exam, cls, subject, topic, rel_path
    )

    added = 0
    for page, content_type, body in read_structured(path):
        if len(body) < 80:
            continue

        for ch in text_chunks(body):
            h = hash_chunk(exam, cls, subject, topic, page, ch)
            cur = c.execute(
                """
                INSERT OR IGNORE INTO chunks
                (h,document_id,source,exam,class,subject,topic,page,content_type,text)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    h, doc_id, source, exam, cls, subject,
                    topic, page, content_type, ch
                ),
            )
            if cur.rowcount:
                c.execute(
                    """
                    INSERT INTO fts(rowid,text,topic,subject,exam,class)
                    VALUES(?,?,?,?,?,?)
                    """,
                    (cur.lastrowid, ch, topic, subject, exam, cls),
                )
                added += 1

            if not capacity_ok():
                c.commit()
                return added

    return added


def ingest_dir(c, root, source, exam, cls, subject):
    total = 0
    exts = {".pdf", ".txt", ".md", ".json", ".jsonl"}

    for base, _, files in os.walk(root):
        for name in files:
            path = os.path.join(base, name)
            if Path(name).suffix.lower() not in exts:
                continue
            if not capacity_ok():
                print("Size target reached.")
                return total

            try:
                n = add_document(
                    c, source, exam, cls, subject,
                    Path(name).stem, path
                )
                total += n
                print(f"{os.path.relpath(path, RAW)}: +{n}")
                c.commit()
            except Exception as exc:
                print(f"SKIP {path}: {exc}")

    return total


def ingest():
    c = connect()
    base = Path(RAW)
    if not base.exists():
        print("Create the raw/ directory first.")
        return

    total = 0
    for root, dirs, _ in os.walk(base):
        rel = Path(root).relative_to(base)
        parts = rel.parts
        if len(parts) != 4:
            continue
        source, exam, cls, subject = parts
        total += ingest_dir(c, root, source, exam, cls, subject)

        if not capacity_ok():
            break

    c.commit()
    print("Total chunks added:", total)
    stats()


def wiki_api(session, **params):
    params["format"] = "json"
    for attempt in range(4):
        try:
            r = session.get(WIKI_API, params=params, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == 3:
                return {}
            time.sleep(1 + attempt)
    return {}


def category_pages(session, category, depth):
    seen = {category}
    pages = set()
    frontier = [category]

    for _ in range(depth + 1):
        next_frontier = []
        for category_name in frontier:
            cont = {}
            while True:
                data = wiki_api(
                    session,
                    action="query",
                    list="categorymembers",
                    cmtitle="Category:" + category_name,
                    cmlimit=500,
                    cmtype="page|subcat",
                    **cont,
                )
                members = data.get("query", {}).get("categorymembers", [])
                for m in members:
                    if m["ns"] == 0:
                        pages.add(m["title"])
                    elif m["ns"] == 14:
                        sub = m["title"][9:]
                        if sub not in seen:
                            seen.add(sub)
                            next_frontier.append(sub)

                if "continue" in data:
                    cont = data["continue"]
                else:
                    break
        frontier = next_frontier

    return pages


def wiki_text(session, title):
    data = wiki_api(
        session,
        action="query",
        prop="extracts",
        explaintext=1,
        redirects=1,
        titles=title,
    )
    try:
        txt = next(iter(data["query"]["pages"].values())).get("extract", "")
    except Exception:
        return ""

    return re.sub(
        r"\n== (See also|References|External links|Further reading|Notes|Bibliography|Sources|Citations) ==.*",
        "",
        txt,
        flags=re.S,
    )


def fetch_wiki(c, session, subject, titles, quota_bytes=None):
    done = {r[0] for r in c.execute("SELECT title FROM done")}
    todo = [t for t in titles if t not in done]
    random.shuffle(todo)

    used = c.execute(
        """
        SELECT COALESCE(SUM(LENGTH(text)),0)
        FROM chunks
        WHERE subject=? AND source='wikipedia'
        """,
        (subject,),
    ).fetchone()[0]

    for start in range(0, len(todo), 25):
        if not capacity_ok() or (
            quota_bytes is not None and used >= quota_bytes
        ):
            return

        batch = todo[start:start + 25]
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(
                pool.map(lambda title: (title, wiki_text(session, title)), batch)
            )

        for title, txt in results:
            c.execute("INSERT OR IGNORE INTO done(title) VALUES(?)", (title,))
            if len(txt) < 1500:
                continue

            temp_root = Path(".wiki_tmp")
            temp_root.mkdir(exist_ok=True)
            tmp = temp_root / (hashlib.sha1(title.encode()).hexdigest() + ".txt")
            tmp.write_text(txt, encoding="utf-8")

            try:
                n = add_document(
                    c, "wikipedia", "advanced", "all",
                    subject, title, str(tmp)
                )
                used += len(txt)
                print(f"Wikipedia {subject}: {title} +{n}")
            finally:
                try:
                    tmp.unlink()
                except Exception:
                    pass

        c.commit()


def wiki():
    import requests

    c = connect()
    s = requests.Session()
    s.headers["User-Agent"] = (
        "FuturePowerAIPlus-edu-db/3.0 "
        "(personal educational knowledge builder)"
    )

    for subject, titles in WIKI_MUST.items():
        fetch_wiki(c, s, subject, titles)

    for subject, categories in WIKI_CATEGORIES.items():
        titles = set()
        for cat, depth in categories:
            titles |= category_pages(s, cat, depth)

        print(subject, "candidate pages:", len(titles))
        fetch_wiki(
            c, s, subject, titles,
            quota_bytes=WIKI_QUOTA_MB[subject] * 1_000_000
        )

    stats()


def repos():
    c = connect()

    for url, subdir, subject, exts in OPEN_REPOS:
        dest = Path("repos") / re.sub(r"\W+", "_", url)
        if not dest.exists():
            Path("repos").mkdir(exist_ok=True)
            try:
                subprocess.run(
                    [
                        "git", "clone", "--depth", "1",
                        "--filter=blob:none", url, str(dest)
                    ],
                    check=True,
                )
            except Exception as exc:
                print("Clone failed:", url, exc)
                continue

        root = dest / subdir
        if not root.exists():
            continue

        total = 0
        for base, _, files in os.walk(root):
            for name in files:
                if Path(name).suffix.lower() not in exts:
                    continue
                if not capacity_ok():
                    print("Size target reached.")
                    break
                try:
                    total += add_document(
                        c,
                        url.split("/")[-1],
                        "reference",
                        "all",
                        subject,
                        Path(name).stem,
                        os.path.join(base, name),
                    )
                except Exception as exc:
                    print("Skip:", name, exc)
            c.commit()

        print(url, "+", total)

        if not capacity_ok():
            break

    stats()


def search(query, limit=8):
    c = connect()
    words = [w for w in re.findall(r"\w+", query.lower()) if w not in STOP]
    if not words:
        print("No searchable terms.")
        return

    fts_query = " OR ".join(f'"{w}"' for w in words[:12])

    rows = c.execute(
        """
        SELECT
            c.source, c.exam, c.class, c.subject, c.topic,
            c.page, snippet(fts, 0, '[', ']', '…', 36)
        FROM fts
        JOIN chunks c ON c.id=fts.rowid
        WHERE fts MATCH ?
        ORDER BY bm25(fts)
        LIMIT ?
        """,
        (fts_query, limit),
    ).fetchall()

    for row in rows:
        print(
            f"{row[0]} | {row[1]} | class={row[2]} | "
            f"{row[3]} | {row[4]} | page={row[5]}"
        )
        print(" ", row[6])
        print()


def finish():
    c = connect()
    c.execute("INSERT INTO fts(fts) VALUES('optimize')")
    c.commit()
    c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    c.execute("VACUUM")
    c.commit()
    stats()


def stats():
    c = connect()
    size = os.path.getsize(DB) if os.path.exists(DB) else 0
    print("education.db size MB:", round(size / 1e6, 1))
    for row in c.execute(
        """
        SELECT source, exam, class, subject,
               COUNT(*), ROUND(SUM(LENGTH(text))/1e6, 1)
        FROM chunks
        GROUP BY 1,2,3,4
        ORDER BY 6 DESC
        """
    ):
        print(row)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return

    command = args[0]

    if command == "ingest":
        ingest()
    elif command == "wiki":
        wiki()
    elif command == "repos":
        repos()
    elif command == "finish":
        finish()
    elif command == "search":
        search(" ".join(args[1:]))
    elif command == "stats":
        stats()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
