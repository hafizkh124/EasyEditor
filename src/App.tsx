import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { Skeleton } from "@/components/ui/skeleton";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import LocalePrefixSync from "@/components/LocalePrefixSync";
import DesktopTitleBarSync from "@/components/DesktopTitleBarSync";
import CapabilityRoute from "@/components/CapabilityRoute";
import FirstRunLanguageGate from "@/components/FirstRunLanguageGate";
import RedirectToWorkspace from "@/components/RedirectToWorkspace";
import { isDesktop } from "@/utils/environment";
import { ThemeProvider } from "next-themes";
import { APP_THEME_STORAGE_KEY } from "@/lib/theme";

const Landing = lazy(() => import("./pages/Landing"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Transcribe = lazy(() => import("./pages/Transcribe"));
const Speak = lazy(() => import("./pages/Speak"));
const OCR = lazy(() => import("./pages/OCR"));
const Settings = lazy(() => import("./pages/Settings"));
const Admin = lazy(() => import("./pages/Admin"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Profile = lazy(() => import("./pages/Profile"));
const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const AccountRejected = lazy(() => import("./pages/AccountRejected"));
const CompleteProfile = lazy(() => import("./pages/CompleteProfile"));
const About = lazy(() => import("./pages/About"));
const FaqAiHaram = lazy(() => import("./pages/FaqAiHaram"));
const Answers = lazy(() => import("./pages/Answers"));
const Workspace = lazy(() => import("./pages/Workspace"));
const OcrReview = lazy(() => import("./pages/OcrReview"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const Terms = lazy(() => import("./pages/legal/Terms"));
const Privacy = lazy(() => import("./pages/legal/Privacy"));
const Refund = lazy(() => import("./pages/legal/Refund"));
const PricingInfo = lazy(() => import("./pages/legal/PricingInfo"));
const MaktabaShamilaGuide = lazy(() => import("./pages/guides/MaktabaShamila"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="h-screen bg-background p-4 md:p-8 space-y-6 max-w-4xl mx-auto pt-16">
    <Skeleton className="h-8 w-48" />
    <div className="space-y-4">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
    <div className="grid grid-cols-2 gap-4">
      <Skeleton className="h-24 rounded-lg" />
      <Skeleton className="h-24 rounded-lg" />
    </div>
  </div>
);

const AppRouter = isDesktop() ? HashRouter : BrowserRouter;

/**
 * The Electron desktop build has no public web surface: no landing page, no
 * marketing/legal pages. It boots straight into the offline workspace. These
 * routes still exist for the web build, so a single set of routes serves both
 * targets — desktop just redirects web-only pages to /workspace.
 */
const DesktopToWorkspace: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  isDesktop() ? <Navigate to="/workspace" replace /> : <>{children}</>;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={APP_THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      <TooltipProvider>
        <LanguageProvider>
          <AuthProvider>
          <FirstRunLanguageGate>
            <SubscriptionProvider>
            <NotificationProvider>
            <Toaster />
            <DesktopTitleBarSync />
            <AppRouter>
              <ErrorBoundary>
                <LocalePrefixSync />
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/" element={<DesktopToWorkspace><Landing /></DesktopToWorkspace>} />
                  <Route path="/pending-approval" element={<PendingApproval />} />
                  <Route path="/account-rejected" element={<AccountRejected />} />
                  <Route path="/complete-profile" element={<CompleteProfile />} />
                  <Route path="/about" element={<DesktopToWorkspace><About /></DesktopToWorkspace>} />
                  <Route path="/faq/is-ai-haram-in-islam" element={<DesktopToWorkspace><FaqAiHaram /></DesktopToWorkspace>} />
                  <Route path="/answers" element={<DesktopToWorkspace><Answers /></DesktopToWorkspace>} />
                  <Route path="/ur/answers" element={<DesktopToWorkspace><Answers /></DesktopToWorkspace>} />
                  <Route path="/ar/answers" element={<DesktopToWorkspace><Answers /></DesktopToWorkspace>} />
                  <Route path="/terms" element={<DesktopToWorkspace><Terms /></DesktopToWorkspace>} />
                  <Route path="/privacy" element={<DesktopToWorkspace><Privacy /></DesktopToWorkspace>} />
                  <Route path="/refund-policy" element={<DesktopToWorkspace><Refund /></DesktopToWorkspace>} />
                  <Route path="/pricing-info" element={<DesktopToWorkspace><PricingInfo /></DesktopToWorkspace>} />
                  <Route path="/guides/maktaba-shamila-tutorial" element={<DesktopToWorkspace><MaktabaShamilaGuide /></DesktopToWorkspace>} />
                  <Route path="/ur/guides/maktaba-shamila-tutorial" element={<DesktopToWorkspace><MaktabaShamilaGuide /></DesktopToWorkspace>} />
                  <Route path="/ar/guides/maktaba-shamila-tutorial" element={<DesktopToWorkspace><MaktabaShamilaGuide /></DesktopToWorkspace>} />
                  {/* Arabic locale mirror — same components, LocalePrefixSync sets language to "ar" */}
                  <Route path="/ar" element={<DesktopToWorkspace><Landing /></DesktopToWorkspace>} />
                  <Route path="/ar/about" element={<DesktopToWorkspace><About /></DesktopToWorkspace>} />
                  <Route path="/ar/faq/is-ai-haram-in-islam" element={<DesktopToWorkspace><FaqAiHaram /></DesktopToWorkspace>} />
                  <Route path="/ar/terms" element={<DesktopToWorkspace><Terms /></DesktopToWorkspace>} />
                  <Route path="/ar/privacy" element={<DesktopToWorkspace><Privacy /></DesktopToWorkspace>} />
                  <Route path="/ar/refund-policy" element={<DesktopToWorkspace><Refund /></DesktopToWorkspace>} />
                  <Route path="/ar/pricing-info" element={<DesktopToWorkspace><PricingInfo /></DesktopToWorkspace>} />
                  {/* Urdu locale mirror */}
                  <Route path="/ur" element={<DesktopToWorkspace><Landing /></DesktopToWorkspace>} />
                  <Route path="/ur/about" element={<DesktopToWorkspace><About /></DesktopToWorkspace>} />
                  <Route path="/ur/faq/is-ai-haram-in-islam" element={<DesktopToWorkspace><FaqAiHaram /></DesktopToWorkspace>} />
                  <Route path="/ur/terms" element={<DesktopToWorkspace><Terms /></DesktopToWorkspace>} />
                  <Route path="/ur/privacy" element={<DesktopToWorkspace><Privacy /></DesktopToWorkspace>} />
                  <Route path="/ur/refund-policy" element={<DesktopToWorkspace><Refund /></DesktopToWorkspace>} />
                  <Route path="/ur/pricing-info" element={<DesktopToWorkspace><PricingInfo /></DesktopToWorkspace>} />
                  <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                  {/* allowGuest: on desktop these run on the offline Whisper/Piper
                      engines, which need no account. CapabilityRoute is what keeps
                      the cloud-only tools off desktop entirely. On web `allowGuest`
                      is inert, so the login gate is unchanged. */}
                  <Route path="/transcribe" element={<CapabilityRoute id="transcribe"><ProtectedRoute allowGuest><ErrorBoundary><Transcribe /></ErrorBoundary></ProtectedRoute></CapabilityRoute>} />
                  <Route path="/speak" element={<CapabilityRoute id="speak"><ProtectedRoute allowGuest><ErrorBoundary><Speak /></ErrorBoundary></ProtectedRoute></CapabilityRoute>} />
                  <Route path="/ocr" element={<CapabilityRoute id="ocr"><ProtectedRoute><ErrorBoundary><OCR /></ErrorBoundary></ProtectedRoute></CapabilityRoute>} />
                  <Route path="/workspace" element={<ProtectedRoute allowGuest><ErrorBoundary><Workspace /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/workspace/:documentId" element={<ProtectedRoute allowGuest><ErrorBoundary><Workspace /></ErrorBoundary></ProtectedRoute>} />
                  {/* /research and /editor are retired pages (UX-v1 P3): the workspace
                      absorbed both in M2, and the flag that could still render their old
                      bodies (VITE_WORKSPACE_SHELL=false) never had a build that set it.
                      Both routes survive only so a bookmark or an external link still
                      lands somewhere real. */}
                  <Route path="/research" element={<Navigate to="/workspace?panel=research" replace />} />
                  {/* /library is a retired page (UX-v1 P3): LibraryPanel inside the
                      workspace is the only Library that was ever linked to. This had
                      zero inbound links anywhere in the app before removal. */}
                  <Route path="/library" element={<Navigate to="/workspace" replace />} />
                  <Route path="/editor" element={<RedirectToWorkspace />} />
                  <Route path="/editor/:documentId" element={<RedirectToWorkspace />} />
                  <Route path="/ocr/review" element={<ProtectedRoute><ErrorBoundary><OcrReview /></ErrorBoundary></ProtectedRoute>} />
                  {/* /translate is a retired page (UX-v1 P3): it mounted
                      the exact same TranslatePanel as its Workbench tab,
                      so the standalone page was a second door to the same room. The
                      capability entry (and CapabilityRoute's desktop gate) stays —
                      only the destination changed. */}
                  <Route path="/translate" element={<CapabilityRoute id="translate"><Navigate to="/workspace?panel=translate" replace /></CapabilityRoute>} />
                  {/* /book-workspace and /translate-workspace are gone. Both
                      predated the three-pillar workspace, which supports
                      `kind: "book"` and `kind: "translation"` natively, and
                      neither was linked from any menu. TranslationWorkspace
                      itself lives on: CanvasPanel renders it embedded when a
                      translation project is open. Book Studio had no such
                      second life and was deleted with its components. */}
                  {/* allowGuest: the desktop sidebar links here, and Settings is where the
                      desktop-local panels live (BYOK key, voice engines). Settings.tsx already
                      guards every cloud call with `if (!user) return`. */}
                  <Route path="/settings" element={<ProtectedRoute allowGuest><Settings /></ProtectedRoute>} />
                  <Route path="/pricing" element={<ProtectedRoute><Pricing /></ProtectedRoute>} />
                  <Route path="/admin" element={<CapabilityRoute id="admin"><ProtectedRoute><Admin /></ProtectedRoute></CapabilityRoute>} />
                  <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                  <Route path="/checkout/success" element={<ProtectedRoute><CheckoutSuccess /></ProtectedRoute>} />
                  <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </AppRouter>
            </NotificationProvider>
            </SubscriptionProvider>
          </FirstRunLanguageGate>
          </AuthProvider>
        </LanguageProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
