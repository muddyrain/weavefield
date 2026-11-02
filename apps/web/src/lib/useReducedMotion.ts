import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';
const snapshot = () => window.matchMedia(query).matches;
const subscribe = (changed: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
};
// 当前 Motion 14.7.1 的 hook 仅捕获初值；外壳还需响应用户实时改变系统偏好。
export const useReducedMotionPreference = () => useSyncExternalStore(subscribe, snapshot, () => false);
