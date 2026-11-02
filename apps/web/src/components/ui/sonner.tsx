// shadcn/Sonner composition for Vite; the existing app supplies its light theme tokens.
import { Toaster as Sonner } from 'sonner';
import { CircleCheck, CircleAlert, Info, LoaderCircle } from 'lucide-react';

export function Toaster() {
  return <Sonner theme="light" position="bottom-right" duration={4000} visibleToasts={2} closeButton
    offset={{ bottom: 48, right: 24 }} mobileOffset={{ bottom: 48, left: 12, right: 12 }}
    className="wf-toaster" toastOptions={{ className: 'wf-toast' }}
    icons={{ success: <CircleCheck/>, error: <CircleAlert/>, info: <Info/>, loading: <LoaderCircle/> }}
    containerAriaLabel="操作通知"/>
}
