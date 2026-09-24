import { useEffect } from 'react';
import Lenis from 'lenis';
import '../styles/landing.css';
import { Hero } from '../components/landing/Hero';
import { Story } from '../components/landing/Story';
import { Footer } from '../components/landing/Footer';
/**
 * Editorial landing microsite — self-contained, new files only.
 * Not wired into the router; App.tsx untouched.
 */
export default function Landing() {
    // (1) Lenis smooth scroll: init on mount, raf loop, destroy on cleanup.
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
        let raf = 0;
        const loop = (time) => {
            lenis.raf(time);
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(raf);
            lenis.destroy();
        };
    }, []);
    // (6) Magnetic hover for .ld-btn: tiny translate toward cursor, springs back on leave.
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        const els = Array.from(document.querySelectorAll('.ld-root .ld-btn'));
        const cleanups = els.map((el) => {
            const onMove = (e) => {
                const r = el.getBoundingClientRect();
                const x = e.clientX - (r.left + r.width / 2);
                const y = e.clientY - (r.top + r.height / 2);
                el.style.transition = 'transform 0.12s ease-out';
                el.style.transform = `translate(${(x * 0.12).toFixed(1)}px, ${(y * 0.18).toFixed(1)}px)`;
            };
            const onLeave = () => {
                el.style.transition = 'transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)';
                el.style.transform = '';
            };
            el.addEventListener('mousemove', onMove);
            el.addEventListener('mouseleave', onLeave);
            return () => {
                el.removeEventListener('mousemove', onMove);
                el.removeEventListener('mouseleave', onLeave);
            };
        });
        return () => {
            cleanups.forEach((fn) => fn());
        };
    }, []);
    return (<div className="ld-root">
      <Hero />
      <main>
        <Story />
      </main>
      <Footer />
    </div>);
}
