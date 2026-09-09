import { Link } from 'react-router-dom';
import { Reveal } from './Reveal';

function TicketRow({ id, title, color, tag }: { id: string; title: string; color: string; tag: string }) {
  return (
    <div className="ld-ticket-row">
      <span>
        <span className="ld-dot" style={{ background: color }} />
        <span className="ld-mono">{id}</span> · {title}
      </span>
      <span className="ld-chip" style={{ fontSize: 11 }}>
        {tag}
      </span>
    </div>
  );
}

function Chapter({ n, title }: { n: string; title: string }) {
  return (
    <p className="ld-chapter" style={{ margin: '0 0 10px' }}>
      {n} — {title}
    </p>
  );
}

function SlaCountdown() {
  return (
    <div className="ld-sla" role="img" aria-label="SLA countdown from 4 hours to breached">
      <div className="ld-sla-time ld-mono">04:00:00</div>
      <div style={{ margin: '10px 0', fontWeight: 800 }}>↓ scroll — the clock runs ↓</div>
      <div className="ld-sla-time breached ld-mono">BREACHED</div>
      <p style={{ fontSize: 13, fontWeight: 600, opacity: 0.75 }}>
        Same ticket. Same team. The only difference: nobody watched the clock.
      </p>
    </div>
  );
}

export function Story() {
  return (
    <>
      {/* 1 — flood */}
      <section id="story-1" className="ld-section alt-paper">
        <div className="ld-wrap">
          <Reveal>
            <Chapter n="Chapter 1" title="The flood" />
            <h2 className="ld-h2">Monday, 9:03 AM. Thirty tickets before coffee.</h2>
            <div className="ld-grid2">
              <p className="ld-lede">
                Password resets, a dead printer, VPN flapping on floor three. Every ticket screams
                “urgent”. Without triage, the loudest voice wins — not the most important outage.
                <br />
                <br />
                Meet <b>TKT-1042</b>: “VPN down for 14 users”, reported by Priya. It looks like one
                more ticket. It isn’t.
              </p>
              <div className="ld-panel">
                <h3>📥 Inbound queue · 9:03 AM</h3>
                <TicketRow id="TKT-1042" title="VPN down for 14 users" color="#c2410c" tag="SEV-1" />
                <TicketRow id="TKT-1043" title="Password reset" color="#1d7a4f" tag="Low" />
                <TicketRow id="TKT-1044" title="Printer jam · Floor 2" color="#b45309" tag="Med" />
                <TicketRow id="TKT-1045" title="VPN slow · Floor 3" color="#b45309" tag="Med" />
                <TicketRow id="TKT-1046" title="VPN timeout · Floor 3" color="#b45309" tag="Med" />
                <p style={{ fontSize: 12, fontWeight: 700, opacity: 0.65, margin: '6px 0 0' }}>
                  + 24 more… scroll to triage →
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 2 — SLA countdown */}
      <section id="story-2" className="ld-section alt-cream">
        <div className="ld-wrap">
          <Reveal>
            <Chapter n="Chapter 2" title="The clock" />
            <h2 className="ld-h2">Every SLA is a countdown. Watch one expire.</h2>
            <div className="ld-grid2">
              <div className="ld-panel">
                <SlaCountdown />
              </div>
              <p className="ld-lede">
                SEV-1 means four hours to resolve — not four hours to <i>notice</i>. TKT-1042 starts
                at <span className="ld-mono">04:00:00</span> with <b>Rahul</b> on point. Escalation
                pings <b>Arjun</b> at 50%, pages the manager at 80%.
                <br />
                <br />
                The opposite of chaos isn’t heroics. It’s a clock everyone can see.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 3 — business hours freeze */}
      <section id="story-3" className="ld-section block-green">
        <div className="ld-wrap">
          <Reveal>
            <Chapter n="Chapter 3" title="Fair clocks" />
            <h2 className="ld-h2">6 PM. The clock freezes — fairly.</h2>
            <div className="ld-grid2">
              <p className="ld-lede">
                Nobody should breach because the sun went down. Business-hour SLAs pause nights,
                weekends, and holidays — then resume exactly where they left off.
                <br />
                <br />
                5:59 PM: <span className="ld-mono">01:12:09</span> left. 9:00 AM Monday: still{' '}
                <span className="ld-mono">01:12:09</span> left. The audit trail proves every pause.
              </p>
              <div className="ld-panel">
                <h3>❄ SLA timeline · TKT-1042</h3>
                <div className="ld-timeline">
                  <div className="ld-tl-node done">
                    <div className="ld-tl-dot">✓</div>
                    Open
                    <br />
                    9:03 AM
                  </div>
                  <div className="ld-tl-bar" />
                  <div className="ld-tl-node done">
                    <div className="ld-tl-dot">✓</div>
                    Working
                    <br />
                    11:20 AM
                  </div>
                  <div className="ld-tl-bar" />
                  <div className="ld-tl-node frozen">
                    <div className="ld-tl-dot">❄</div>
                    Frozen
                    <br />
                    6:00 PM
                  </div>
                  <div className="ld-tl-bar" />
                  <div className="ld-tl-node">
                    <div className="ld-tl-dot">▶</div>
                    Resume
                    <br />
                    9:00 AM
                  </div>
                </div>
                <p className="ld-mono" style={{ fontSize: 12 }}>
                  pause event · 18:00:00 · policy “IN-Business-Hours” · by system
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 4 — problem */}
      <section id="story-4" className="ld-section alt-paper">
        <div className="ld-wrap">
          <Reveal>
            <Chapter n="Chapter 4" title="Pattern, not pile" />
            <h2 className="ld-h2">Thirty tickets. One problem: INC-004.</h2>
            <div className="ld-grid2">
              <div className="ld-panel">
                <h3>🔗 Linked incidents → Problem INC-004 “Floor-3 gateway flapping”</h3>
                <TicketRow id="TKT-1042" title="VPN down · 14 users" color="#c2410c" tag="linked" />
                <TicketRow id="TKT-1045" title="VPN slow · Floor 3" color="#b45309" tag="linked" />
                <TicketRow id="TKT-1046" title="VPN timeout · Floor 3" color="#b45309" tag="linked" />
                <TicketRow id="TKT-1051" title="VPN drops · Floor 3" color="#b45309" tag="linked" />
                <p style={{ fontSize: 13, fontWeight: 700 }}>
                  Root cause fix → closes all 30 at once. Owner: <b>Aman</b>.
                </p>
              </div>
              <p className="ld-lede">
                Incidents are symptoms; problems are diseases. Link the thirty VPN tickets to one
                problem record, fix the gateway once, and resolve the whole cluster.
                <br />
                <br />
                That’s the difference between firefighting and engineering.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 5 — knowledge graph */}
      <section id="story-5" className="ld-section alt-cream">
        <div className="ld-wrap">
          <Reveal>
            <Chapter n="Chapter 5" title="Answers, connected" />
            <h2 className="ld-h2">The knowledge graph already knew.</h2>
            <div className="ld-grid2">
              <p className="ld-lede">
                <span className="ld-mono">KB-102 “VPN client setup”</span> links to{' '}
                <span className="ld-mono">KB-118 “Gateway failover reset”</span>, which links to
                asset <span className="ld-mono">LAP-1029</span>’s driver notes. Articles cite each
                other, so the fix travels further than any single memory.
              </p>
              <div className="ld-panel" style={{ textAlign: 'center' }}>
                <h3>🕸 Related articles</h3>
                <div className="ld-kg">
                  <span className="ld-kg-node">KB-102 · VPN setup</span>
                  <span style={{ alignSelf: 'center', fontWeight: 900 }}>↔</span>
                  <span className="ld-kg-node" style={{ background: '#ede7fb' }}>
                    KB-118 · Failover reset ★
                  </span>
                  <span style={{ alignSelf: 'center', fontWeight: 900 }}>↔</span>
                  <span className="ld-kg-node">LAP-1029 notes</span>
                </div>
                <p style={{ fontSize: 13, fontWeight: 600, opacity: 0.7 }}>
                  Priya solved it in 4 min with KB-118 — no escalation needed.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 6 — deflection demo */}
      <section id="story-6" className="ld-section block-ink">
        <div className="ld-wrap">
          <Reveal>
            <Chapter n="Chapter 6" title="The deflection" />
            <h2 className="ld-h2">“VPN not connecting.” Answered before it became a ticket.</h2>
            <div className="ld-grid2">
              <div className="ld-panel">
                <h3>💬 Portal assistant · live demo</h3>
                <div className="ld-chat">
                  <div className="ld-bubble user">vpn not connecting since morning 😰</div>
                  <div className="ld-bubble ai">
                    ✦ Found <b>KB-118 “Gateway failover reset”</b> (94% match). Step 1: disconnect
                    client → Step 2: flush route cache → Step 3: reconnect to <b>vpn-east</b>. Did
                    that work?
                  </div>
                  <div className="ld-bubble user">yes! connected 🎉</div>
                  <div className="ld-bubble ai">Resolved without a ticket — nice. Logged as deflected by KB-118.</div>
                </div>
              </div>
              <p className="ld-lede">
                One in three chats ends here: no queue, no wait, no ticket. Deflection isn’t
                dodging work — it’s delivering the answer at the exact moment of need.
                <br />
                <br />
                Every deflection is logged, so the KB earns its keep in public.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 7 — flywheel */}
      <section id="story-7" className="ld-section alt-paper">
        <div className="ld-wrap">
          <Reveal>
            <Chapter n="Chapter 7" title="The loop" />
            <h2 className="ld-h2">Every resolution makes the next one faster.</h2>
            <p className="ld-lede">
              Ticket → article → deflection → fewer tickets → deeper articles. The flywheel spins:
              Rahul resolves TKT-1042, documents it as KB-118 v2, and next month’s flood is 32%
              smaller.
            </p>
            <div className="ld-flywheel">
              {['🎫 Resolve TKT-1042', '📝 Write KB-118 v2', '✦ Deflect 32% chats', '📉 −30 tickets / week'].map(
                (s) => (
                  <div key={s} className="ld-fw-step">
                    {s}
                  </div>
                ),
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* 8 — asset story */}
      <section id="story-8" className="ld-section alt-cream">
        <div className="ld-wrap">
          <Reveal>
            <Chapter n="Chapter 8" title="Every laptop has a past" />
            <h2 className="ld-h2">LAP-1029 has been here before.</h2>
            <div className="ld-grid2">
              <p className="ld-lede">
                Three VPN tickets, two driver faults, one warranty claim — all on the same laptop.
                The asset timeline connects tickets to hardware, so Arjun replaces the NIC instead
                of reimaging for the fourth time.
              </p>
              <div className="ld-panel">
                <h3>💻 LAP-1029 · ThinkPad T14 · assigned: Priya</h3>
                <dl className="ld-asset-grid">
                  <dt>Health</dt>
                  <dd>⚠ Degraded — 3 repeat incidents</dd>
                  <dt>Warranty</dt>
                  <dd>🟡 Expires in 42 days</dd>
                  <dt>Tickets</dt>
                  <dd className="ld-mono">TKT-1042 · TKT-0987 · TKT-0911</dd>
                  <dt>Action</dt>
                  <dd>NIC replacement approved by Arjun</dd>
                </dl>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 9 — dashboard teaser */}
      <section id="story-9" className="ld-section block-green">
        <div className="ld-wrap">
          <Reveal>
            <Chapter n="Chapter 9" title="Proof, not promises" />
            <h2 className="ld-h2">The dashboard tells Monday’s story in numbers.</h2>
            <div className="ld-dash">
              {[
                ['98.2%', 'SLA met · 7d'],
                ['32%', 'deflected by KB'],
                ['4m 10s', 'median first response'],
                ['−30', 'repeat tickets / week'],
              ].map(([v, l]) => (
                <div key={l} className="ld-stat">
                  <b>{v}</b>
                  <small>{l}</small>
                </div>
              ))}
            </div>
            <div className="ld-btn-row">
              <Link to="/dashboard" className="ld-btn" style={{ background: '#fff', color: '#16130c' }}>
                Enter Service Desk →
              </Link>
              <Link
                to="/login"
                className="ld-btn"
                style={{ background: 'transparent', color: '#fff', borderColor: '#fff' }}
              >
                Sign in
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
