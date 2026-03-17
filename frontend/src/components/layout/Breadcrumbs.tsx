import { Link, useLocation } from 'react-router';
import { ChevronRight, Home } from 'lucide-react';

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, i) => ({
    label: seg,
    path: '/' + segments.slice(0, i + 1).join('/'),
  }));

  return (
    <nav className="flex items-center gap-1 text-sm text-text-secondary mb-4">
      <Link to="/" className="hover:text-primary">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb, i) => (
        <span key={crumb.path} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          {i === crumbs.length - 1 ? (
            <span className="text-text font-medium">{crumb.label}</span>
          ) : (
            <Link to={crumb.path} className="hover:text-primary">{crumb.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
