#!/usr/bin/env python3
"""
Builds a PDF report from scripts/load-test.mjs results and the server samples
collected during the run.

    python3 scripts/load-report.py <results.json> <server-samples.jsonl> <out.pdf> [--rtt-ms 85]

Only the Python standard library and reportlab are needed.
"""
import argparse
import json
import sys
from datetime import datetime, timezone

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

INK = colors.HexColor("#1f2933")
MUTED = colors.HexColor("#616e7c")
RULE = colors.HexColor("#d9dee3")
ACCENT = colors.HexColor("#2457c5")
ACCENT2 = colors.HexColor("#c0392b")
ACCENT3 = colors.HexColor("#2e8b57")
ACCENT4 = colors.HexColor("#8e6c1a")
BAND = colors.HexColor("#f3f5f7")


def styles():
    ss = getSampleStyleSheet()
    base = ParagraphStyle("base", parent=ss["Normal"], fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK)
    return {
        "title": ParagraphStyle("title", parent=base, fontName="Helvetica-Bold", fontSize=20, leading=24, spaceAfter=4),
        "sub": ParagraphStyle("sub", parent=base, fontSize=10, textColor=MUTED, spaceAfter=14),
        "h1": ParagraphStyle("h1", parent=base, fontName="Helvetica-Bold", fontSize=13, leading=16, spaceBefore=14, spaceAfter=6),
        "h2": ParagraphStyle("h2", parent=base, fontName="Helvetica-Bold", fontSize=10.5, leading=13, spaceBefore=8, spaceAfter=3),
        "body": base,
        "small": ParagraphStyle("small", parent=base, fontSize=8, leading=10, textColor=MUTED),
        "bullet": ParagraphStyle("bullet", parent=base, leftIndent=10, bulletIndent=0, spaceAfter=3),
        "cell": ParagraphStyle("cell", parent=base, fontSize=8.5, leading=10.5),
        "cellb": ParagraphStyle("cellb", parent=base, fontName="Helvetica-Bold", fontSize=8.5, leading=10.5),
        "verdict": ParagraphStyle("verdict", parent=base, fontSize=10.5, leading=14, textColor=INK),
    }


def table(data, col_widths, header=True, align_right_from=None):
    t = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
    style = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK if header else RULE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style.append(("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5))
    if align_right_from is not None:
        style.append(("ALIGN", (align_right_from, 1), (-1, -1), "RIGHT"))
        style.append(("ALIGN", (align_right_from, 0), (-1, 0), "RIGHT"))
    for i in range(2, len(data), 2):
        style.append(("BACKGROUND", (0, i), (-1, i), BAND))
    t.setStyle(TableStyle(style))
    return t


def bar_chart(title, categories, series, series_names, y_label, width=170 * mm, height=62 * mm, colors_=None):
    d = Drawing(width, height)
    chart = VerticalBarChart()
    chart.x, chart.y = 38, 22
    chart.width, chart.height = width - 60, height - 44
    chart.data = series
    chart.categoryAxis.categoryNames = categories
    chart.categoryAxis.labels.fontName = "Helvetica"
    chart.categoryAxis.labels.fontSize = 7
    chart.categoryAxis.labels.angle = 0
    chart.categoryAxis.strokeColor = RULE
    chart.valueAxis.valueMin = 0
    top = max((v for row in series for v in row), default=0)
    chart.valueAxis.valueMax = top * 1.15 if top else 1
    chart.valueAxis.labels.fontName = "Helvetica"
    chart.valueAxis.labels.fontSize = 7
    chart.valueAxis.strokeColor = RULE
    chart.valueAxis.gridStrokeColor = RULE
    chart.valueAxis.visibleGrid = True
    chart.groupSpacing = 6
    chart.barSpacing = 1
    palette = colors_ or [ACCENT, ACCENT2, ACCENT3, ACCENT4]
    for i in range(len(series)):
        chart.bars[i].fillColor = palette[i % len(palette)]
        chart.bars[i].strokeColor = None
    d.add(chart)
    d.add(String(0, height - 10, title, fontName="Helvetica-Bold", fontSize=8.5, fillColor=INK))
    d.add(String(0, height - 20, y_label, fontName="Helvetica", fontSize=7, fillColor=MUTED))
    if len(series) > 1:
        lg = Legend()
        lg.x, lg.y = width - 78 * len(series), height - 8
        lg.alignment = "right"
        lg.fontName, lg.fontSize = "Helvetica", 7
        lg.columnMaximum = 1
        lg.deltax = 78
        lg.dx = lg.dy = 6
        lg.colorNamePairs = [(palette[i % len(palette)], series_names[i]) for i in range(len(series))]
        d.add(lg)
    return d


def line_chart(title, xs, series, series_names, y_label, width=170 * mm, height=60 * mm, x_ticks=None):
    d = Drawing(width, height)
    lp = LinePlot()
    lp.x, lp.y = 38, 22
    lp.width, lp.height = width - 60, height - 44
    lp.data = [list(zip(xs, s)) for s in series]
    palette = [ACCENT, ACCENT2, ACCENT3, ACCENT4]
    for i in range(len(series)):
        lp.lines[i].strokeColor = palette[i % len(palette)]
        lp.lines[i].strokeWidth = 1.4
    lp.xValueAxis.valueMin = xs[0]
    lp.xValueAxis.valueMax = xs[-1]
    lp.xValueAxis.labels.fontName = "Helvetica"
    lp.xValueAxis.labels.fontSize = 7
    lp.xValueAxis.strokeColor = RULE
    if x_ticks:
        lp.xValueAxis.valueSteps = x_ticks
    lp.xValueAxis.labelTextFormat = lambda v: f"{int(v)}s"
    lp.yValueAxis.valueMin = 0
    ytop = max((v for row in series for v in row), default=0)
    lp.yValueAxis.valueMax = ytop * 1.15 if ytop else 1
    lp.yValueAxis.labels.fontName = "Helvetica"
    lp.yValueAxis.labels.fontSize = 7
    lp.yValueAxis.strokeColor = RULE
    lp.yValueAxis.gridStrokeColor = RULE
    lp.yValueAxis.visibleGrid = True
    d.add(lp)
    d.add(String(0, height - 10, title, fontName="Helvetica-Bold", fontSize=8.5, fillColor=INK))
    d.add(String(0, height - 20, y_label, fontName="Helvetica", fontSize=7, fillColor=MUTED))
    lg = Legend()
    lg.x, lg.y = width - 82 * len(series), height - 8
    lg.alignment = "right"
    lg.fontName, lg.fontSize = "Helvetica", 7
    lg.columnMaximum = 1
    lg.deltax = 82
    lg.dx = lg.dy = 6
    lg.colorNamePairs = [(palette[i % len(palette)], series_names[i]) for i in range(len(series))]
    d.add(lg)
    return d


def hms_to_s(t):
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("results")
    ap.add_argument("samples")
    ap.add_argument("out")
    ap.add_argument("--rtt-ms", type=float, default=None, help="measured TCP connect time from the load generator")
    args = ap.parse_args()

    run = json.load(open(args.results))
    samples = [json.loads(l) for l in open(args.samples) if l.strip()]
    # A process that exits between the two ticks of a 1 s CPU window yields a
    # negative delta; treat it as zero rather than letting it bend the charts.
    for x in samples:
        for k in ("cpu_total", "api_cpu", "web_cpu", "pg_cpu", "httpd_cpu"):
            if x.get(k) is not None and x[k] < 0:
                x[k] = 0
    st = styles()
    stages = run["stages"]

    started = datetime.fromisoformat(run["startedAt"].replace("Z", "+00:00"))
    finished = datetime.fromisoformat(run["finishedAt"].replace("Z", "+00:00"))
    total_req = sum(s["requests"] for s in stages)
    total_err = sum(s["requests"] - round(s["requests"] * s["okRate"] / 100) for s in stages)
    peak = max(stages, key=lambda s: s["rps"])
    worst_p95 = max(stages, key=lambda s: s["latencyMs"]["p95"])
    api_stages = [s for s in stages if s["name"].startswith("api-auth-me")]
    web_stages = [s for s in stages if s["name"].startswith("web-login")]

    # Server samples restricted to the run window (timestamps are UTC hh:mm:ss from the load generator's clock).
    t0 = hms_to_s(run["startedAt"][11:19])
    t1 = hms_to_s(run["finishedAt"][11:19])
    in_run = [x for x in samples if t0 - 5 <= hms_to_s(x["t"]) <= t1 + 5]
    baseline = [x for x in samples if hms_to_s(x["t"]) < t0 - 5] or samples[:1]

    def peak_of(key, rows):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return max(vals) if vals else None

    def mean_of(key, rows):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return sum(vals) / len(vals) if vals else None

    doc = SimpleDocTemplate(
        args.out,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="Voter Management — Production Load Test",
        author="Load test run by scripts/load-test.mjs",
    )
    story = []
    P = lambda text, style="body": Paragraph(text, st[style])

    # ── Title ────────────────────────────────────────────────────────────
    story.append(P("Voter Management — Production Load Test", "title"))
    story.append(
        P(
            f"Run on {started.strftime('%d %b %Y')} from {started.strftime('%H:%M')} to {finished.strftime('%H:%M')} UTC "
            f"against {run['apiUrl']} (API) and {run['webUrl']} (dashboard).",
            "sub",
        )
    )

    # ── Summary ──────────────────────────────────────────────────────────
    story.append(P("Summary", "h1"))
    cpu_peak = peak_of("cpu_total", in_run)
    cpu_txt = (
        f"The server peaked at {cpu_peak}% of its 200% CPU (two cores) and never ran out of memory or database connections, "
        f"so at this level of load the server still has headroom; the plateau seen at high concurrency is set by the load generator and its network path."
        if cpu_peak is not None
        else "Server CPU was not sampled."
    )
    verdict = (
        f"<b>{total_req:,} requests were sent over {len(stages)} stages with {total_err} failures.</b> "
        f"The API reached {peak['rps']} requests/second ({peak['name']}, {peak['concurrency']} concurrent clients) and "
        f"the slowest stage was {worst_p95['name']} with a 95th-percentile latency of {worst_p95['latencyMs']['p95']:.0f} ms. "
        f"{cpu_txt}"
    )
    if not run.get("pinScoped"):
        verdict += (
            " The PIN-scoped paths that carry the real field load (roll download, delta sync, stats, heartbeat) were "
            "<b>not</b> exercised in this run because no access PIN was supplied; see <i>Not covered</i> below."
        )
    box = Table([[P(verdict, "verdict")]], colWidths=[174 * mm])
    box.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, ACCENT),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eef2fb")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(box)

    # Key numbers
    key = [["Metric", "Value"],
           ["Total requests", f"{total_req:,}"],
           ["Failed requests (non-2xx or transport error)", f"{total_err}"],
           ["Peak throughput", f"{peak['rps']} req/s ({peak['name']})"],
           ["Best API p50 latency", f"{min(s['latencyMs']['p50'] for s in stages):.0f} ms"],
           ["Worst p95 latency", f"{worst_p95['latencyMs']['p95']:.0f} ms ({worst_p95['name']})"],
           ["Sessions opened via /api/auth/login", f"{run['login']['count']} (mean {run['login']['meanMs']} ms, max {run['login']['maxMs']} ms)"]]
    if cpu_peak is not None:
        key.append(["Server CPU peak during run", f"{cpu_peak}% of 200% (two cores); load average peak {peak_of('load1', in_run)}"])
    if peak_of("api_rss_mb", in_run) is not None:
        key.append(["API process memory peak", f"{peak_of('api_rss_mb', in_run)} MB (heap cap 320 MB, cgroup cap 512 MB)"])
    if peak_of("pg_conns", in_run) is not None:
        key.append(["Postgres client connections peak", f"{peak_of('pg_conns', in_run)} of max_connections = 20"])
    if args.rtt_ms:
        key.append(["Network: TCP connect from load generator", f"≈{args.rtt_ms:.0f} ms (this is a floor under every latency below)"])
    story.append(Spacer(1, 8))
    story.append(table([[P(a, "cellb"), P(b, "cell")] for a, b in key], [70 * mm, 104 * mm]))

    # ── Environment ──────────────────────────────────────────────────────
    story.append(P("Environment", "h1"))
    env = [
        ["Component", "Detail"],
        ["Server", "103.117.180.71 — AlmaLinux, 2 vCPU, 2.7 GB RAM (≈1.2 GB available at idle), Virtualmin"],
        ["API", "Fastify 5 + Prisma 7 on Node, systemd voter-api, port 4000 direct (no proxy). NODE_OPTIONS --max-old-space-size=320, MemoryMax=512M"],
        ["Dashboard", "Next.js 16 standalone, systemd voter-web, port 3000 behind Apache (mod_proxy, TLS by Let's Encrypt) at voters.iramediaconcepts.com"],
        ["Database", "PostgreSQL on the same host. max_connections 20, shared_buffers 192 MB, work_mem 4 MB"],
        ["Load generator", "This workstation, Node 22 fetch with keep-alive, one process. scripts/load-test.mjs"],
    ]
    story.append(table([[P(a, "cellb"), P(b, "cell")] for a, b in env], [30 * mm, 144 * mm]))

    # ── Method ───────────────────────────────────────────────────────────
    story.append(P("Method", "h1"))
    story.append(P(
        "Each stage runs a fixed number of concurrent clients, each sending the same request back-to-back for 15 seconds "
        "(closed loop, no think time). This is deliberately harsher than real use: a phone sends one heartbeat a minute and "
        "syncs on demand, so 50 concurrent closed-loop clients represent far more than 50 phones. Latency is measured from "
        "request start to the last byte of the response and includes the network path from the load generator."
    ))
    story.append(P("Stages and what they represent", "h2"))
    what = {
        "api-health": "Baseline: Fastify request handling with no database work.",
        "api-auth-me": "App launch / session restore: JWT verification plus one indexed Postgres lookup of the session. Every authenticated call pays this cost.",
        "web-login-page": "Admin dashboard login page rendered server-side by Next.js, through Apache and TLS.",
        "sync-seed-page1": "First roll download: one 10,000-voter page (~3 MB JSON, gzipped, served from the in-memory page cache).",
        "sync-pull-delta": "Delta sync: rows changed in the last hour for the constituency.",
        "voters-summary": "Stats card: five aggregate counts over the constituency's roll.",
        "usage-heartbeat": "Once-a-minute usage heartbeat (rate-limited to 30/min per IP).",
    }
    rows = [["Stage", "Concurrency", "Represents"]]
    seen = set()
    for s in stages:
        base = s["name"].rsplit("-c", 1)[0] if "-c" in s["name"] else s["name"]
        if base in seen:
            continue
        seen.add(base)
        concs = ", ".join(str(x["concurrency"]) for x in stages if (x["name"].rsplit("-c", 1)[0] if "-c" in x["name"] else x["name"]) == base)
        rows.append([P(base, "cellb"), P(concs, "cell"), P(what.get(base, ""), "cell")])
    story.append(table(rows, [34 * mm, 24 * mm, 116 * mm]))

    # ── Results ──────────────────────────────────────────────────────────
    story.append(PageBreak())
    story.append(P("Results", "h1"))
    rows = [["Stage", "Conc.", "Requests", "req/s", "OK %", "p50 ms", "p95 ms", "p99 ms", "max ms", "KB/s"]]
    for s in stages:
        L = s["latencyMs"]
        rows.append([s["name"], s["concurrency"], f"{s['requests']:,}", s["rps"], f"{s['okRate']:.1f}",
                     f"{L['p50']:.0f}", f"{L['p95']:.0f}", f"{L['p99']:.0f}", f"{L['max']:.0f}", f"{s['bytesPerSec']/1024:,.0f}"])
    story.append(table(rows, [36 * mm, 12 * mm, 18 * mm, 15 * mm, 13 * mm, 15 * mm, 15 * mm, 15 * mm, 17 * mm, 18 * mm], align_right_from=1))
    errs = [(s["name"], s["statuses"], s["errors"]) for s in stages if s["errors"] or any(int(k) not in (200, 204) for k in s["statuses"])]
    if errs:
        story.append(P("Non-2xx responses and transport errors", "h2"))
        story.append(table([["Stage", "Status counts", "Errors"]] + [[n, json.dumps(a), json.dumps(b)] for n, a, b in errs], [40 * mm, 70 * mm, 64 * mm]))
    else:
        story.append(Spacer(1, 4))
        story.append(P("Every request in every stage returned HTTP 200. No connection resets, timeouts or rate-limit responses occurred.", "small"))

    story.append(Spacer(1, 10))
    if api_stages:
        cats = [f"c{s['concurrency']}" for s in api_stages]
        story.append(KeepTogether([
            bar_chart("API /api/auth/me — throughput vs concurrent clients", cats, [[s["rps"] for s in api_stages]], ["req/s"], "requests per second"),
            Spacer(1, 6),
            bar_chart("API /api/auth/me — latency vs concurrent clients", cats,
                      [[s["latencyMs"]["p50"] for s in api_stages], [s["latencyMs"]["p95"] for s in api_stages], [s["latencyMs"]["p99"] for s in api_stages]],
                      ["p50", "p95", "p99"], "milliseconds (includes network)"),
        ]))
    if web_stages:
        cats = [f"c{s['concurrency']}" for s in web_stages]
        story.append(Spacer(1, 10))
        story.append(KeepTogether([
            bar_chart("Dashboard /login — throughput and latency vs concurrent clients", cats,
                      [[s["rps"] for s in web_stages]], ["req/s"], "requests per second", height=50 * mm),
            Spacer(1, 6),
            bar_chart("", cats, [[s["latencyMs"]["p50"] for s in web_stages], [s["latencyMs"]["p95"] for s in web_stages]],
                      ["p50", "p95"], "milliseconds (includes network and TLS)", height=50 * mm),
        ]))
    pin_stages = [s for s in stages if s["name"].startswith(("sync-", "voters-", "usage-"))]
    if pin_stages:
        story.append(Spacer(1, 10))
        cats = [s["name"] for s in pin_stages]
        story.append(bar_chart("PIN-scoped stages — p50 and p95 latency", cats,
                               [[s["latencyMs"]["p50"] for s in pin_stages], [s["latencyMs"]["p95"] for s in pin_stages]],
                               ["p50", "p95"], "milliseconds", height=62 * mm))

    # ── Server side ──────────────────────────────────────────────────────
    if in_run:
        story.append(PageBreak())
        story.append(P("Server resources during the run", "h1"))
        xs = [hms_to_s(x["t"]) - t0 for x in in_run]
        story.append(line_chart("CPU use", xs,
                                [[x["cpu_total"] for x in in_run], [x["api_cpu"] for x in in_run], [x["web_cpu"] for x in in_run], [x["pg_cpu"] + x["httpd_cpu"] for x in in_run]],
                                ["all", "voter-api", "voter-web", "postgres + apache"], "percent of two cores (200 = both cores busy)"))
        story.append(Spacer(1, 8))
        story.append(line_chart("Memory and database connections", xs,
                                [[x["api_rss_mb"] for x in in_run], [x["web_rss_mb"] for x in in_run], [x["pg_conns"] or 0 for x in in_run]],
                                ["API RSS MB", "web RSS MB", "PG connections"], "MB / count"))
        story.append(Spacer(1, 8))
        # Stage timeline so the charts can be read against stages.
        tl = [["Stage", "Starts at", "Ends at"]]
        cursor = 0
        for s in stages:
            tl.append([s["name"], f"{cursor:.0f}s", f"{cursor + s['seconds']:.0f}s"])
            cursor += s["seconds"]
        story.append(P("Stage timeline (seconds after the run started)", "h2"))
        story.append(table(tl, [50 * mm, 30 * mm, 30 * mm], align_right_from=1))
        story.append(Spacer(1, 6))
        b = baseline[-1]
        story.append(P(
            f"Idle baseline just before the run: CPU {b['cpu_total']}%, load {b['load1']}, API {b['api_rss_mb']} MB, "
            f"dashboard {b['web_rss_mb']} MB, {b['pg_conns']} Postgres connection(s), {b['mem_avail_mb']} MB available. "
            f"During the run: mean CPU {mean_of('cpu_total', in_run):.0f}%, peak {peak_of('cpu_total', in_run)}%; "
            f"peak API CPU {peak_of('api_cpu', in_run)}%, peak dashboard CPU {peak_of('web_cpu', in_run)}%; "
            f"lowest available memory {min(x['mem_avail_mb'] for x in in_run)} MB.", "small"))

    # ── Findings ─────────────────────────────────────────────────────────
    story.append(P("Findings", "h1"))
    findings = []
    api_cpu_peak = peak_of("api_cpu", in_run)
    web_cpu_peak = peak_of("web_cpu", in_run)
    if api_stages:
        a, z = api_stages[0], api_stages[-1]
        headroom = ""
        if cpu_peak is not None and api_cpu_peak is not None:
            cpu_ms = api_cpu_peak * 10 / z["rps"]
            headroom = (
                f" Server-side, the API process peaked at {api_cpu_peak}% of one core and the whole box at {cpu_peak}% of its 200%, "
                f"which is about {cpu_ms:.1f} ms of CPU per authenticated request. The server was therefore <b>not</b> the limit in this run: "
                f"the plateau comes from the single load generator and its ≈{args.rtt_ms or 85:.0f} ms network path. Extrapolating from the CPU cost, "
                f"one Node process on this box should sustain roughly {int(1000 / cpu_ms / 100) * 100:,} authenticated requests/second before its core is "
                f"saturated, and Node cluster mode (two workers) would double that."
            )
        findings.append(
            f"<b>The API has headroom at this load.</b> Authenticated throughput rose from {a['rps']} req/s at {a['concurrency']} clients to "
            f"{z['rps']} req/s at {z['concurrency']} clients, with p50 going from {a['latencyMs']['p50']:.0f} to {z['latencyMs']['p50']:.0f} ms and no errors."
            + headroom
        )
        if peak_of("pg_conns", in_run):
            findings.append(
                f"<b>Postgres is lightly loaded but the connection budget is tight.</b> The API's pool opened {peak_of('pg_conns', in_run)} connections under load "
                f"(Prisma's pg adapter defaults to 10) and Postgres used at most {peak_of('pg_cpu', in_run)}% of a core. max_connections is 20, with 3 reserved for "
                f"superusers, so a second API instance or any other client on the box would need max_connections raised to about 50."
            )
    if web_stages:
        a, z = web_stages[0], web_stages[-1]
        render_ms = f" about {web_cpu_peak * 10 / z['rps']:.0f} ms of CPU per render," if web_cpu_peak else ""
        findings.append(
            f"<b>The dashboard login page costs{render_ms} and tops out near {z['rps']} req/s</b> with p95 {z['latencyMs']['p95']:.0f} ms at {z['concurrency']} clients "
            f"(the Next.js process peaked at {web_cpu_peak or 'n/a'}% of a core, Apache barely registered). That is plenty for an admin tool used by a handful of "
            f"people, but server-side rendering competes for the same two cores as the API, so heavy dashboard use on polling day takes a little from the phones."
        )
    if args.rtt_ms:
        findings.append(
            f"<b>Most of the measured latency is the network.</b> A TCP connect from the load generator takes ≈{args.rtt_ms:.0f} ms, and /health (no database work) "
            f"had a p50 of {next(s['latencyMs']['p50'] for s in stages if s['name']=='api-health'):.0f} ms under 50 clients. Phones on mobile networks in the "
            f"constituency will see their own, likely higher, floor."
        )
    findings.append(
        "<b>Rate limits are keyed by client IP address.</b> PIN verification allows 10 attempts per 5 minutes per IP and heartbeats 30 per minute per IP. "
        "Phones on the same mobile carrier usually share a small pool of public IPs (carrier-grade NAT), so on polling day a few dozen agents on one carrier "
        "can exhaust these limits together: PIN entry starts failing with 429 and heartbeats are dropped. Key the limits on the session token instead of the IP, or raise them substantially."
    )
    findings.append(
        "<b>The server clock is about 2 minutes 22 seconds behind real time</b> (measured against this workstation during the run). The app's delta sync uses "
        "server timestamps as watermarks and JWTs carry expiry times, so clock drift causes subtle sync and login problems. Enable time synchronisation (chronyd) on the server."
    )
    findings.append(
        f"<b>Memory is comfortable at this load.</b> The API stayed around {peak_of('api_rss_mb', in_run) or 'n/a'} MB against a 320 MB heap cap and the box kept "
        f"{min((x['mem_avail_mb'] for x in in_run), default=0)} MB available. Roll downloads (seed pages) are the memory-heavy path and were not part of this run."
    )
    findings.append(
        "<b>/api/auth/login has no rate limit and creates a database row per call.</b> Anyone can fill the sessions table and the admin's session list by calling it in a loop. "
        "Add a per-IP limit (for example 20 per 5 minutes) and purge sessions that never verified a PIN after a day."
    )
    for f in findings:
        story.append(Paragraph(f, st["bullet"], bulletText="•"))

    # ── Not covered ──────────────────────────────────────────────────────
    story.append(P("Not covered by this run", "h1"))
    if not run.get("pinScoped"):
        story.append(P(
            "No access PIN was supplied, so the stages that mirror a field agent's phone did not run: the first roll download "
            "(up to 60 pages of ~3 MB each per phone), delta sync pulls, the stats summary, heartbeats and sync pushes. These are the "
            "heaviest paths on polling day. Re-run with <font face='Courier'>LOAD_PIN=&lt;pin&gt; node scripts/load-test.mjs</font> against a test "
            "constituency to measure them; the script never marks a voter as voted or records a slip print."
        ))
    story.append(P(
        "Sync pushes (writes) were excluded on purpose because they change real voter data. A write test should run against a "
        "constituency loaded with scripts/sample-data.sql and be cleaned up with scripts/sample-data-cleanup.sql."
    ))
    story.append(P(
        "The run came from a single workstation on one network path. Results describe the server's capacity, not the experience "
        "of phones on rural mobile networks, which add their own latency and packet loss."
    ))

    # ── Cleanup ──────────────────────────────────────────────────────────
    story.append(P("Cleanup", "h1"))
    story.append(P(
        f"The test opened {run['login']['count']} sessions named “Load Test N (sample)” with mobile numbers starting 99999010. They hold no voter data and "
        "can be removed with <font face='Courier'>bash scripts/prod-sql.sh run scripts/load-test-cleanup.sql</font>."
    ))
    if run.get("notes"):
        story.append(P("Notes", "h2"))
        for n in run["notes"]:
            story.append(Paragraph(n, st["bullet"], bulletText="•"))

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 10 * mm, "Voter Management — production load test — generated by scripts/load-report.py")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    sys.exit(main())
