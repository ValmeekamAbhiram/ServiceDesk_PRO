import '../styles/landing.css';
import { Hero } from '../components/landing/Hero';
import { Story } from '../components/landing/Story';
import { Footer } from '../components/landing/Footer';

/**
 * Editorial landing microsite — self-contained, new files only.
 * Not wired into the router; App.tsx untouched.
 */
export default function Landing() {
  return (
    <div className="ld-root">
      <Hero />
      <main>
        <Story />
      </main>
      <Footer />
    </div>
  );
}
