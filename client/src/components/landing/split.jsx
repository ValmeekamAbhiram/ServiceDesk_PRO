import { Fragment, useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
/**
 * Masked word-by-word rise (y 110% → 0, staggered) on first in-view.
 *
 * Failsafe: a 1.5s timer forces the end state even if the in-view signal
 * never arrives (blocked observer, throttled tab, reduced-motion edge).
 * Text must never be stuck invisible — worst case it renders statically.
 */
export function SplitWords({ text, className }) {
    const reduce = useReducedMotion();
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: '-8% 0px' });
    const [forced, setForced] = useState(false);
    useEffect(() => {
        if (reduce || inView)
            return;
        const t = window.setTimeout(() => setForced(true), 1500);
        return () => window.clearTimeout(t);
    }, [reduce, inView]);
    if (reduce)
        return <span className={className}>{text}</span>;
    const shown = inView || forced;
    const words = text.split(' ');
    return (<span ref={ref} className={className}>
      {words.map((w, i) => (<Fragment key={`${i}-${w}`}>
          {i > 0 ? ' ' : null}
          <span className="ld-mask">
            <motion.span className="ld-mask-inner" initial={{ y: '110%' }} animate={{ y: shown ? '0%' : '110%' }} transition={{ duration: 0.55, delay: i * 0.045, ease: [0.22, 1, 0.36, 1] }}>
              {w}
            </motion.span>
          </span>
        </Fragment>))}
    </span>);
}
