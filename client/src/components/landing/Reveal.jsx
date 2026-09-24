import { useEffect, useRef } from 'react';
/** Scroll-reveal wrapper using IntersectionObserver (no deps). */
export function Reveal({ children, className = '', as = 'div' }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        el.classList.add('ld-reveal');
        if (typeof IntersectionObserver === 'undefined') {
            el.classList.add('ld-visible');
            return;
        }
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    e.target.classList.add('ld-visible');
                    io.unobserve(e.target);
                }
            }
        }, { threshold: 0.12 });
        io.observe(el);
        return () => io.disconnect();
    }, []);
    if (as === 'section') {
        return (<section ref={ref} className={className}>
        {children}
      </section>);
    }
    return (<div ref={ref} className={className}>
      {children}
    </div>);
}
