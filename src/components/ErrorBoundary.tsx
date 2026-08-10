import React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Copy, Check, RotateCw } from "lucide-react";
import { translateStored } from "@/lib/i18n";
import { isDesktop } from "@/utils/environment";
import { logger } from "@/lib/logger";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

/**
 * The last thing a user sees when a render throws, so it has to survive the
 * conditions that got it here. Three things it previously got wrong:
 *
 *  • "Return to Home" set `window.location.href = "/"`. The desktop build runs
 *    under HashRouter on `file://`, where "/" is the filesystem root — the app
 *    went blank and the only way out was to kill it.
 *  • Its copy was hardcoded English while the rest of the app is translated.
 *    It reads the language from localStorage rather than LanguageContext,
 *    because a boundary can be mounted above the provider (App.tsx wraps the
 *    router in one) and must not throw a second time trying to render.
 *  • It printed `error.message` as the main body text. That is noise to a
 *    scholar and the one thing support actually needs, so it moves into a
 *    collapsed block with a copy button.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error("Render failed", { message: error.message, stack: error.stack });
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private details(): string {
    const { error, componentStack } = this.state;
    return [error?.message, error?.stack, componentStack].filter(Boolean).join("\n\n");
  }

  handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(this.details());
      this.setState({ copied: true });
    } catch {
      /* clipboard blocked — the text is selectable in the <pre> either way */
    }
  };

  /** A reload keeps the current route, which is usually the cheapest recovery. */
  handleReload = () => window.location.reload();

  handleGoHome = () => {
    // HashRouter (desktop) needs the route in the fragment; BrowserRouter (web)
    // needs it in the path. Getting this wrong is what blanked the desktop app.
    if (isDesktop()) {
      window.location.hash = "#/workspace";
      window.location.reload();
    } else {
      window.location.assign("/");
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const t = translateStored;

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6 text-center">
        <div className="rounded-full bg-destructive/10 p-4 mb-4">
          <AlertTriangle className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">
          {t("error.title", "Something went wrong")}
        </h1>
        <p className="text-muted-foreground mb-6 max-w-md">
          {t("error.description", "An unexpected error occurred. You can try reloading, or go back to the app.")}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          <Button onClick={this.handleReload} className="gap-2 min-h-touch">
            <RotateCw className="h-4 w-4" />
            {t("error.reload", "Reload")}
          </Button>
          <Button variant="outline" onClick={this.handleGoHome} className="min-h-touch">
            {t("error.go_home", "Back to the app")}
          </Button>
        </div>

        {this.state.error && (
          <details className="w-full max-w-lg text-start">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              {t("error.details", "Technical details")}
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground whitespace-pre-wrap">
              {this.details()}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              onClick={this.handleCopy}
              className="mt-2 gap-2"
            >
              {this.state.copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {this.state.copied ? t("error.copied", "Copied") : t("error.copy", "Copy details")}
            </Button>
          </details>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
