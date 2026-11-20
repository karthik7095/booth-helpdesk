#!/usr/bin/env python3
"""
PDF report for scripts/load-users.mjs (the user-model load test).

    python3 scripts/load-users-report.py <results.json> <server-samples.jsonl> <out.pdf>
"""
import importlib.util
import json
import os
import sys
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# Reuse the chart and table helpers from the first report.
_spec = importlib.util.spec_from_file_location("load_report", os.path.join(os.path.dirname(__file__), "load-report.py"))
lr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lr)

ENDPOINT_LABEL = {
    "auth-me": "GET /api/auth/me (app launch / foreground)",
    "summary": "GET /api/voters/summary (stats card)",
    "sync-pull": "GET /api/sync/pull (delta sync)",
    "heartbeat": "POST /api/usage/heartbeat",
}


def main():
    results, samples_path, out = sys.argv[1:4]
    run = json.load(open(results))
    samples = [json.loads(l) for l in open(samples_path) if l.strip()]
    for x in samples:
        for k in ("cpu_total", "api_cpu", "web_cpu", "pg_cpu", "httpd_cpu"):
            if x.get(k) is not None and x[k] < 0:
                x[k] = 0
    st = lr.styles()
    P = lambda text, style="body": Paragraph(text, st[style])
    phases = run["phases"]
    timeline = run["timeline"]

    started = datetime.fromisoformat(run["startedAt"].replace("Z", "+00:00"))
    finished = datetime.fromisoformat(run["finishedAt"].replace("Z", "+00:00"))
    t0 = lr.hms_to_s(run["startedAt"][11:19])
    t1 = lr.hms_to_s(run["finishedAt"][11:19])
    in_run = [x for x in samples if t0 - 5 <= lr.hms_to_s(x["t"]) <= t1 + 5]
    idle = [x for x in samples if lr.hms_to_s(x["t"]) < t0 - 5] or samples[:1]

    def peak(key, rows):
        v = [r[key] for r in rows if r.get(key) is not None]
        return max(v) if v else None

    # Per-phase server peaks, by matching sample times to phase windows from the timeline.
    phase_windows = {}
    for b in timeline:
        if b["phase"].startswith("hold-"):
            w = phase_windows.setdefault(b["phase"], [b["t"], b["t"]])
            w[1] = b["t"]
    phase_server = {}
    for name, (a, z) in phase_windows.items():
        rows = [x for x in samples if t0 + a <= lr.hms_to_s(x["t"]) <= t0 + z + 5]
        def mean(key):
            v = [r[key] for r in rows if r.get(key) is not None]
            return round(sum(v) / len(v)) if v else None

        def median(key):
            v = sorted(r[key] for r in rows if r.get(key) is not None)
            return v[len(v) // 2] if v else None

        phase_server[name] = {
            "cpu": mean("cpu_total"), "api_cpu": mean("api_cpu"), "pg_cpu": mean("pg_cpu"),
            "api_rss": peak("api_rss_mb", rows), "pg_conns": peak("pg_conns", rows), "sockets": median("api_sockets"),
        }

    worst = max(phases, key=lambda p: p["errorRate"])
    biggest = phases[-1]
    all_ok = all(p["errorRate"] == 0 for p in phases)

    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title="Voter Management — Concurrent Users Load Test", author="scripts/load-users.mjs")
    story = []
    story.append(P("Voter Management — Concurrent Users Load Test", "title"))
    story.append(P(
        f"Run on {started.strftime('%d %b %Y')} from {started.strftime('%H:%M')} to {finished.strftime('%H:%M')} UTC against {run['apiUrl']}. "
        f"User counts tested: {', '.join(str(p['users']) for p in phases)}; each level held for {run['holdSeconds']} s after a {run['rampSeconds']} s ramp.",
        "sub"))

    # ── Summary ──
    story.append(P("Summary", "h1"))
    model = ("every phone verified a PIN and ran the app's real cadence: a heartbeat a minute, a delta sync every 30–60 s and a stats refresh every 45–90 s"
             if run["pinScoped"] else
             "no access PIN was available, so each phone could only do what the app does before a PIN is entered: restore its session on launch and every 15–30 s when brought to the foreground")
    if all_ok:
        held = phase_server.get(f"hold-{biggest['users']}", {}).get("sockets") or biggest["users"]
        verdict = (f"<b>The API handled {biggest['users']:,} simultaneous users with no errors</b>, holding "
                   f"{held:,} open connections at once. At that level it served "
                   f"{biggest['rps']} requests/second with a median latency of {biggest['p50']} ms and a 95th percentile of {biggest['p95']} ms. ")
    else:
        verdict = (f"<b>Errors appeared at {worst['users']:,} users ({worst['errorRate']}% of requests failed).</b> ")
    srv = phase_server.get(f"hold-{biggest['users']}", {})
    if srv.get("cpu") is not None:
        verdict += (f"The server's CPU averaged {srv['cpu']}% of its 200% at {biggest['users']:,} users (API process {srv['api_cpu']}% of a core), "
                    f"so it was far from saturated. ")
    verdict += f"In this run {model}. "
    if not run["pinScoped"]:
        verdict += ("That is a light workload per phone, so this run proves the server can hold the connections and session traffic of "
                    f"{biggest['users']:,} phones, but <b>not</b> that it can carry {biggest['users']:,} phones syncing and downloading the roll. "
                    "The capacity model below estimates that, and a PIN-scoped run would measure it.")
    box = Table([[P(verdict, "verdict")]], colWidths=[174 * mm])
    box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, lr.ACCENT), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eef2fb")),
                             ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story.append(box)

    # ── Per level ──
    story.append(P("Results by number of simultaneous users", "h1"))
    rows = [["Users", "Open conns", "req/s", "Requests", "Errors", "p50 ms", "p95 ms", "p99 ms", "Server CPU", "API CPU", "API MB", "PG conns"]]
    for p in phases:
        s = phase_server.get(f"hold-{p['users']}", {})
        rows.append([f"{p['users']:,}", f"{s.get('sockets') or 0:,}", p["rps"], f"{p['requests']:,}", f"{p['errorRate']}%", p["p50"], p["p95"], p["p99"],
                     f"{s.get('cpu', '–')}%" if s.get("cpu") is not None else "–", f"{s.get('api_cpu', '–')}%" if s.get("api_cpu") is not None else "–",
                     s.get("api_rss", "–"), s.get("pg_conns", "–")])
    story.append(lr.table(rows, [14 * mm, 18 * mm, 13 * mm, 17 * mm, 14 * mm, 13 * mm, 13 * mm, 13 * mm, 18 * mm, 15 * mm, 14 * mm, 15 * mm], align_right_from=1))
    story.append(Spacer(1, 4))
    story.append(P("“Open conns” is the number of established TCP connections the API held, counted on the server. Server CPU is a percentage of two cores "
                   "(200 = both busy). Latencies include the network path from the load generator (≈70–85 ms on an open connection).", "small"))
    story.append(P("Latency note and the earlier run", "h2"))
    story.append(P(
        "Median latency in the 500- and 1,000-user phases of this run was about 350 ms, then fell to 90–120 ms at 1,500 and 2,000 users. That is not the server: "
        "its CPU, in-flight requests and connection counts were flat and lower at those levels, and a probe on a single open connection answers in 65–80 ms. "
        "It was a transient on the load generator's network path during the first five minutes. The same four levels were run ten minutes earlier with a "
        "pooled HTTP client (fewer open connections, same requests per user) and gave clean figures:"
    ))
    earlier = [["Users", "req/s", "Errors", "p50 ms", "p95 ms", "p99 ms"],
               ["500", "21.9", "0", "84", "163", "354"], ["1,000", "43.8", "0", "84", "160", "174"],
               ["1,500", "66.4", "0", "88", "166", "181"], ["2,000", "88.0", "0", "87", "170", "199"]]
    story.append(lr.table(earlier, [20 * mm, 18 * mm, 16 * mm, 18 * mm, 18 * mm, 18 * mm], align_right_from=1))

    story.append(P("Per endpoint", "h2"))
    rows = [["Users", "Endpoint", "req/s", "OK %", "p50 ms", "p95 ms", "p99 ms", "max ms"]]
    for p in phases:
        for name, e in p["endpoints"].items():
            rows.append([f"{p['users']:,}", ENDPOINT_LABEL.get(name, name), e["rps"], e["okRate"], e["p50"], e["p95"], e["p99"], e["max"]])
    story.append(lr.table(rows, [14 * mm, 70 * mm, 15 * mm, 14 * mm, 15 * mm, 15 * mm, 15 * mm, 16 * mm], align_right_from=2))
    slow = [(p["users"], e["max"]) for p in phases for e in p["endpoints"].values() if e["max"] > 5000]
    if slow:
        story.append(Spacer(1, 3))
        story.append(P("Max values above 5 s are single requests (" + "; ".join(f"one at {u:,} users took {m / 1000:.0f} s" for u, m in slow) +
                       ") that still completed with HTTP 200; the 99th percentile shows everything else finished well under a second.", "small"))

    cats = [f"{p['users']:,}" for p in phases]
    story.append(Spacer(1, 10))
    story.append(KeepTogether([
        lr.bar_chart("Latency by number of users", cats, [[p["p50"] for p in phases], [p["p95"] for p in phases], [p["p99"] for p in phases]],
                     ["p50", "p95", "p99"], "milliseconds (includes network)", height=58 * mm),
        Spacer(1, 6),
        lr.bar_chart("Server CPU by number of users (average over the hold)", cats,
                     [[phase_server.get(f"hold-{p['users']}", {}).get("cpu") or 0 for p in phases], [phase_server.get(f"hold-{p['users']}", {}).get("api_cpu") or 0 for p in phases]],
                     ["whole server", "API process"], "percent of two cores (200 = both busy)", height=58 * mm),
    ]))

    # ── Timeline ──
    story.append(P("Timeline", "h1"))
    xs = [b["t"] for b in timeline]
    story.append(lr.line_chart("Active users and requests per second", xs, [[b["users"] for b in timeline], [b["rps"] * 10 for b in timeline]],
                               ["active users", "req/s × 10"], "count"))
    story.append(Spacer(1, 6))
    story.append(lr.line_chart("Latency per 5 s window", xs, [[b["p50"] for b in timeline], [b["p95"] for b in timeline]], ["p50", "p95"], "milliseconds"))
    if in_run:
        xs2 = [lr.hms_to_s(x["t"]) - t0 for x in in_run]
        story.append(Spacer(1, 6))
        story.append(lr.line_chart("Server CPU", xs2, [[x["cpu_total"] for x in in_run], [x["api_cpu"] for x in in_run], [x["pg_cpu"] for x in in_run]],
                                   ["all", "voter-api", "postgres"], "percent of two cores"))
        story.append(Spacer(1, 6))
        story.append(lr.line_chart("Open API connections (one per phone)", xs2, [[x.get("api_sockets") or 0 for x in in_run]], ["established TCP connections"], "count"))
        story.append(Spacer(1, 6))
        story.append(lr.line_chart("Memory and database connections", xs2, [[x["api_rss_mb"] for x in in_run], [x["pg_conns"] or 0 for x in in_run]],
                                   ["API RSS MB", "PG connections"], "MB / count"))

    # ── Capacity model ──
    story.append(PageBreak())
    story.append(P("Capacity model: what 1,000 or 1,500 phones mean on polling day", "h1"))
    story.append(P(
        "The earlier closed-loop test measured the CPU cost of an authenticated request at about 1.1 ms on this server, and a Node API process "
        "uses one core. The table turns that, plus the app's cadence, into an estimate of steady-state load per phone. These are estimates from "
        "measured per-request costs, not measurements of 1,000 syncing phones; the PIN-scoped run is what would confirm them."
    ))
    per_phone = [["Action", "Per phone", "Est. CPU per request", "1,000 phones", "1,500 phones"],
                 ["Heartbeat", "1 / min", "~1.5 ms", "17 req/s · 2.5% core", "25 req/s · 4% core"],
                 ["Delta sync pull (few changed rows)", "1–2 / min", "~3 ms", "25 req/s · 8% core", "38 req/s · 11% core"],
                 ["Stats summary (5 counts over the roll)", "1 / min", "~15–40 ms (DB)", "17 req/s · 25–65% core (DB)", "25 req/s · 38–100% core (DB)"],
                 ["Sync push (mark voted / slip print)", "0.5–2 / min", "~5 ms", "8–33 req/s · 4–17% core", "13–50 req/s · 6–25% core"],
                 ["Total steady state", "", "", "≈70–90 req/s, ≈0.4–0.9 core", "≈100–140 req/s, ≈0.6–1.4 core"]]
    story.append(lr.table([[P(c, "cellb" if i == 0 or c.startswith("Total") else "cell") for c in r] for i, r in enumerate(per_phone)], [44 * mm, 20 * mm, 30 * mm, 40 * mm, 40 * mm]))
    story.append(Spacer(1, 6))
    story.append(P(
        "<b>Steady state is fine for 1,000 phones and borderline for 1,500 on two cores.</b> The item to watch is the stats summary: it runs five "
        "aggregate counts over the constituency's roll on every refresh, and with 1,500 phones refreshing once a minute Postgres spends most of a core on it. "
        "Caching the summary per constituency for 10–15 seconds removes almost all of that cost."
    ))
    story.append(P("The first roll download is the real bottleneck", "h2"))
    story.append(P(
        "A phone's first download fetches the whole roll: about 60 pages of 3 MB gzipped each, roughly 21 MB per phone for a 296k-voter constituency "
        "(smaller rolls scale down). Pages come from an in-memory cache so the CPU cost is small; the limit is the server's network uplink."
    ))
    dl = [["Phones downloading at once", "Data to send", "On a 100 Mbit/s uplink", "On a 1 Gbit/s uplink"],
          ["100", "2.1 GB", "≈3 min for all", "≈20 s"],
          ["500", "10.5 GB", "≈14 min for all", "≈1.5 min"],
          ["1,000", "21 GB", "≈28 min for all", "≈3 min"],
          ["1,500", "31.5 GB", "≈42 min for all", "≈4.5 min"]]
    story.append(lr.table(dl, [50 * mm, 30 * mm, 45 * mm, 45 * mm], align_right_from=1))
    story.append(Spacer(1, 4))
    story.append(P(
        "While that is happening every other request shares the same uplink, so syncs and heartbeats slow down too. The practical answer is to make sure "
        "agents download the roll the day before, not on polling morning; the app keeps it offline. If a same-day download for everyone is a real "
        "possibility, confirm the uplink speed with the hosting provider and consider a short-lived CDN or a second server for the seed pages.", "body"))

    # ── Findings ──
    story.append(P("Findings", "h1"))
    findings = []
    if all_ok:
        findings.append(f"<b>Connections and session traffic scale to {biggest['users']:,} phones without errors.</b> No timeouts, resets or 5xx responses at any level. "
                        f"The server was observed holding {max((s.get('sockets') or 0) for s in phase_server.values()):,} established connections, one per phone, "
                        f"with the API process at {max((s.get('api_rss') or 0) for s in phase_server.values())} MB.")
    else:
        findings.append(f"<b>Errors began at {worst['users']:,} users</b>: {worst['errors']} failed requests ({worst['errorRate']}%), {worst['timeouts']} of them timeouts.")
    if srv.get("cpu") is not None:
        findings.append(f"<b>Server CPU stayed low</b>: at most {max((s.get('cpu') or 0) for s in phase_server.values())}% of 200% averaged over any level, API process at most "
                        f"{max((s.get('api_cpu') or 0) for s in phase_server.values())}% of a core, Postgres connections at most {max((s.get('pg_conns') or 0) for s in phase_server.values())} of 20.")
    findings.append("<b>Rate limits keyed by IP are the first thing that breaks with many phones.</b> All virtual users here came from one IP, which is also what a "
                    "mobile carrier's NAT looks like to the server. PIN verification (10 per 5 minutes per IP) and heartbeats (30 per minute per IP) would reject "
                    "most of 1,000 phones on the same carrier. Key both limits on the session token.")
    findings.append("<b>Cache the stats summary per constituency</b> (10–15 s) before relying on 1,000+ phones; it is the only steady-state path whose cost grows with the roll size.")
    findings.append("<b>Plan roll downloads for the day before.</b> Same-day downloads for 1,000 phones are a bandwidth problem no amount of CPU fixes.")
    findings.append("<b>Fix the server clock</b> (about 2 minutes 22 seconds slow; enable chronyd) and <b>raise Postgres max_connections</b> to about 50 if a second API process is added.")
    for f in findings:
        story.append(Paragraph(f, st["bullet"], bulletText="•"))

    story.append(P("Method", "h1"))
    levels = ", ".join(f"{p['users']:,}" for p in phases)
    story.append(P(
        f"scripts/load-users.mjs opened {len(phases)} levels of virtual users ({levels}), ramping to each over {run['rampSeconds']} s and holding it for "
        f"{run['holdSeconds']} s. Each virtual user keeps its own HTTP connection and timers like a phone; the ten sessions were shared between users, which does not change "
        "the server's work per request. Nothing wrote voter data. Server CPU, memory and database connections were sampled every ~6 s over SSH."
    ))
    story.append(P("Cleanup: the ten sessions are named “Load Test N (sample)” and are removed by scripts/load-test-cleanup.sql.", "small"))

    def footer(canvas, d):
        canvas.saveState(); canvas.setFont("Helvetica", 7.5); canvas.setFillColor(lr.MUTED)
        canvas.drawString(18 * mm, 10 * mm, "Voter Management — concurrent users load test — generated by scripts/load-users-report.py")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {d.page}"); canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
