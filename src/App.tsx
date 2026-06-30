import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { Skeleton } from "@/components/ui/skeleton";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import LocalePrefixSync from "@/components/LocalePrefixSync";

const Landing = lazy(() => import("./pages/Landing"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Transcribe = lazy(() => import("./pages/Transcribe"));
const Speak = lazy(() => import("./pages/Speak"));
const OCR = lazy(() => import("./pages/OCR"));
const Research = lazy(() => import("./pages/Research"));
const Settings = lazy(() => import("./pages/Settings"));
const Admin = lazy(() => import("./pages/Admin"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Profile = lazy(() => import("./pages/Profile"));
const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const AccountRejected = lazy(() => import("./pages/AccountRejected"));
const CompleteProfile = lazy(() => import("./pages/CompleteProfile"));
const About = lazy(() => import("./pages/About"));
const FaqAiHaram = lazy(() => import("./pages/FaqAiHaram"));
const Editor = lazy(() => import("./pages/Editor"));
const OcrReview = lazy(() => import("./pages/OcrReview"));
const Translate = lazy(() => import("./pages/Translate"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const Terms = lazy(() => import("./pages/legal/Terms"));
const Privacy = lazy(() => import("./pages/legal/Privacy"));
const Refund = lazy(() => import("./pages/legal/Refund"));
const PricingInfo = lazy(() => import("./pages/legal/PricingInfo"));

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <LanguageProvider>
        <AuthProvider>
          <SubscriptionProvider>
          <NotificationProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ErrorBoundary>
              <LocalePrefixSync />
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/signup" element={<Signup />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/" element={<Landing />} />
                  <Route path="/pending-approval" element={<PendingApproval />} />
                  <Route path="/account-rejected" element={<AccountRejected />} />
                  <Route path="/complete-profile" element={<CompleteProfile />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/faq/is-ai-haram-in-islam" element={<FaqAiHaram />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/refund-policy" element={<Refund />} />
                  <Route path="/pricing-info" element={<PricingInfo />} />
                  {/* Arabic locale mirror — same components, LocalePrefixSync sets language to "ar" */}
                  <Route path="/ar" element={<Landing />} />
                  <Route path="/ar/about" element={<About />} />
                  <Route path="/ar/faq/is-ai-haram-in-islam" element={<FaqAiHaram />} />
                  <Route path="/ar/terms" element={<Terms />} />
                  <Route path="/ar/privacy" element={<Privacy />} />
                  <Route path="/ar/refund-policy" element={<Refund />} />
                  <Route path="/ar/pricing-info" element={<PricingInfo />} />
                  {/* Urdu locale mirror */}
                  <Route path="/ur" element={<Landing />} />
                  <Route path="/ur/about" element={<About />} />
                  <Route path="/ur/faq/is-ai-haram-in-islam" element={<FaqAiHaram />} />
                  <Route path="/ur/terms" element={<Terms />} />
                  <Route path="/ur/privacy" element={<Privacy />} />
                  <Route path="/ur/refund-policy" element={<Refund />} />
                  <Route path="/ur/pricing-info" element={<PricingInfo />} />
                  <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                  <Route path="/transcribe" element={<ProtectedRoute><ErrorBoundary><Transcribe /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/speak" element={<ProtectedRoute><ErrorBoundary><Speak /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/ocr" element={<ProtectedRoute><ErrorBoundary><OCR /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/research" element={<ProtectedRoute><ErrorBoundary><Research /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/editor" element={<ProtectedRoute><ErrorBoundary><Editor /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/ocr/review" element={<ProtectedRoute><ErrorBoundary><OcrReview /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/translate" element={<ProtectedRoute><ErrorBoundary><Translate /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                  <Route path="/pricing" element={<ProtectedRoute><Pricing /></ProtectedRoute>} />
                  <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
                  <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                  <Route path="/checkout/success" element={<ProtectedRoute><CheckoutSuccess /></ProtectedRoute>} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
          </NotificationProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </LanguageProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
