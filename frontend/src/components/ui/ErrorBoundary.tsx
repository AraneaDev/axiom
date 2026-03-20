import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Component, type ReactNode } from 'react';

import { Button } from './Button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleGoBack = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-8">
          <AlertTriangle className="h-12 w-12 text-warning mb-4" />
          <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
          <p className="text-sm text-text-secondary mb-4 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={this.handleGoBack}>
              <ArrowLeft className="h-4 w-4" /> Go back
            </Button>
            <Button onClick={this.handleReset}>
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
