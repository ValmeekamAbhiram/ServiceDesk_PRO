import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="ld-footer">
      <div className="ld-wrap ld-footer-grid">
        <div style={{ maxWidth: 320 }}>
          <p style={{ fontWeight: 900, fontSize: 18, margin: '0 0 8px' }}>ServiceDesk Pro</p>
          <p style={{ fontSize: 14, opacity: 0.75, lineHeight: 1.6 }}>
            IT support without the chaos. SLAs, problems, knowledge, and assets — one calm desk.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link to="/" className="ld-btn ld-btn-green">
              Enter Service Desk →
            </Link>
          </p>
        </div>
        <div>
          <h4>Product</h4>
          <p>
            <Link to="/">Dashboard</Link>
          </p>
          <p>
            <Link to="/login">Sign in</Link>
          </p>
          <p>
            <a href="#story-5">Knowledge base</a>
          </p>
          <p>
            <a href="#story-9">Reports</a>
          </p>
        </div>
        <div>
          <h4>Story</h4>
          <p>
            <a href="#story-1">The flood</a>
          </p>
          <p>
            <a href="#story-3">Business hours</a>
          </p>
          <p>
            <a href="#story-4">INC-004</a>
          </p>
          <p>
            <a href="#story-8">LAP-1029</a>
          </p>
        </div>
      </div>
      <div className="ld-wrap" style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid rgba(250,246,238,0.2)', fontSize: 12, opacity: 0.6 }}>
        ServiceDesk Pro · editorial demo with mock data (TKT-1042, INC-004, LAP-1029, KB-102/118). No real tickets were harmed.
      </div>
    </footer>
  );
}
