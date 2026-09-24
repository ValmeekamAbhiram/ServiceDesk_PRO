import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { SplitWords } from './split';
export function Hero() {
    const headRef = useRef(null);
    const reduce = useReducedMotion();
    const { scrollYProgress } = useScroll({ target: headRef, offset: ['start start', 'end start'] });
    // Parallax: card clusters drift up at different speeds as the hero scrolls out.
    const y1 = useTransform(scrollYProgress, [0, 1], [0, -50]);
    const y2 = useTransform(scrollYProgress, [0, 1], [0, -110]);
    const y3 = useTransform(scrollYProgress, [0, 1], [0, -80]);
    return (<header ref={headRef} className="ld-hero">
      <nav className="ld-nav" aria-label="Landing">
        <div className="ld-nav-inner">
          <Link to="/" className="ld-brand">
            <span>SD</span>ServiceDesk Pro
          </Link>
          <div className="ld-nav-links">
            <a className="ld-hide-m" href="#story-1">
              Story
            </a>
            <a className="ld-hide-m" href="#story-5">
              Knowledge
            </a>
            <a className="ld-hide-m" href="#story-9">
              Dashboard
            </a>
            <Link to="/login" className="ld-chip g" style={{ textDecoration: 'none' }}>
              Sign in →
            </Link>
          </div>
        </div>
      </nav>

      <div className="ld-wrap ld-hero-grid">
        <div>
          <span className="ld-kicker">A story in 9 chapters · ITIL in practice</span>
          <h1 className="ld-h1">
            <SplitWords text="IT SUPPORT, WITHOUT"/>
            <br />
            <SplitWords text="THE CHAOS." className="ld-outline"/>
          </h1>
          <p className="ld-lede" style={{ marginTop: 18 }}>
            Monday, 9:03 AM. Thirty tickets land in the queue before stand-up. This is the story of
            how a service desk turns the flood into flow — SLAs that pause after hours, problems
            behind incidents, and answers that arrive before the ticket does.
          </p>
          <div className="ld-btn-row">
            <Link to="/dashboard" className="ld-btn ld-btn-green">
              Enter Service Desk →
            </Link>
            <Link to="/login" className="ld-btn ld-btn-ghost">
              Sign in
            </Link>
          </div>
          <div className="ld-ticker" aria-label="Highlights">
            <span className="ld-chip g">✓ 32% deflected by KB</span>
            <span className="ld-chip a">⏱ Business-hour SLAs</span>
            <span className="ld-chip p">✦ AI triage on every ticket</span>
          </div>
        </div>

        <div className="ld-stage" aria-hidden="true">
          <motion.div className="ld-para p1" style={reduce ? undefined : { y: y1 }}>
            <div className="ld-card-float c1">
              <span className="ld-pill" style={{ background: '#fde8dc' }}>
                🔴 SEV-1 · TKT-1042
              </span>
              <b>VPN down for 14 users</b>
              <small>SLA 04:00:00 · Rahul assigned</small>
            </div>
          </motion.div>
          <motion.div className="ld-para p2" style={reduce ? undefined : { y: y2 }}>
            <div className="ld-card-float c2">
              <span className="ld-pill" style={{ background: '#fdf0d5' }}>
                ⏱ SLA CLOCK
              </span>
              <b className="ld-mono" style={{ fontSize: 20 }}>
                03:12:44
              </b>
              <small>Paused at 6 PM — business hours</small>
            </div>
          </motion.div>
          <motion.div className="ld-para p3" style={reduce ? undefined : { y: y3 }}>
            <div className="ld-card-float c3">
              <span className="ld-pill" style={{ background: '#ede7fb' }}>
                ✦ AI TRIAGE
              </span>
              <b>Suggested: KB-118 “VPN reset”</b>
              <small>Confidence 94% · one-click apply</small>
            </div>
          </motion.div>
          <div className="ld-badge-spin" aria-hidden="true">
            <svg viewBox="0 0 120 120">
              <defs>
                <path id="ld-badge-circle" d="M60,60 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0" fill="none"/>
              </defs>
              <text className="ld-badge-text">
                <textPath href="#ld-badge-circle" textLength="280">
                  AI TRIAGE • SLA CLOCK •
                </textPath>
              </text>
            </svg>
            <span className="ld-badge-center">✦</span>
          </div>
        </div>
      </div>

      <div className="ld-marquee" aria-hidden="true">
        <div className="ld-marquee-inner">
          {Array.from({ length: 2 }).map((_, i) => (<span key={i}>
              SLA CLOCKS THAT TELL THE TRUTH&nbsp;&nbsp;·&nbsp;&nbsp;30 TICKETS → ONE PROBLEM&nbsp;&nbsp;·&nbsp;&nbsp;ANSWERS
              BEFORE TICKETS&nbsp;&nbsp;·&nbsp;&nbsp;LAP-1029 HAS A HISTORY&nbsp;&nbsp;·&nbsp;&nbsp;
            </span>))}
        </div>
      </div>
    </header>);
}
