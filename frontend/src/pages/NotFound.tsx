import { ArrowLeft, FileQuestion } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/Button';

/**
 *
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="text-center max-w-md">
        <FileQuestion className="h-16 w-16 text-text-tertiary mx-auto mb-6" />
        <h1 className="text-4xl font-bold text-text mb-2">404</h1>
        <p className="text-lg text-text-secondary mb-8">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link to="/">
          <Button size="lg">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
