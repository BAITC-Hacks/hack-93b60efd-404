import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (p: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const IconPlus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMic = (p: P) => (
  <svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const IconArrowUp = (p: P) => (
  <svg {...base(p)}><path d="M12 19V5M6 11l6-6 6 6" /></svg>
);
export const IconStop = (p: P) => (
  <svg {...base(p)}><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" /></svg>
);
export const IconSidebar = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>
);
export const IconTrace = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16M6 9h5M6 13h3" /></svg>
);
export const IconSpeaker = (p: P) => (
  <svg {...base(p)}><path d="M4 10v4h4l5 4V6L8 10H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>
);
export const IconSpeakerOff = (p: P) => (
  <svg {...base(p)}><path d="M4 10v4h4l5 4V6L8 10H4z" /><path d="M17 9l5 6M22 9l-5 6" /></svg>
);
export const IconChart = (p: P) => (
  <svg {...base(p)}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
export const IconChat = (p: P) => (
  <svg {...base(p)}><path d="M5 18l-2 3V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5z" /></svg>
);
export const IconTrash = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
);
export const IconBolt = (p: P) => (
  <svg {...base(p)}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>
);
export const IconBranch = (p: P) => (
  <svg {...base(p)}><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="9" r="2" /><path d="M6 7v10M18 11c0 4-6 3-12 6" /></svg>
);
export const IconHeadset = (p: P) => (
  <svg {...base(p)}><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /><path d="M19 20a3 3 0 0 1-3 2h-3" /></svg>
);
export const IconClose = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7" /></svg>
);
export const IconAlert = (p: P) => (
  <svg {...base(p)}><path d="M12 4l9 16H3l9-16z" /><path d="M12 10v4M12 17.5v.5" /></svg>
);
export const IconRefresh = (p: P) => (
  <svg {...base(p)}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
);

export const IconMenu = (p: P) => (
  <svg {...base(p)}><path d="M4 8h16M4 16h10" /></svg>
);
export const IconSliders = (p: P) => (
  <svg {...base(p)}><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></svg>
);
export const IconWaves = (p: P) => (
  <svg {...base(p)}><path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 11v2" /></svg>
);
export const IconMicOff = (p: P) => (
  <svg {...base(p)}><path d="M9 9V6a3 3 0 0 1 5.6-1.5M15 11v0a3 3 0 0 1-4.3 2.7M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" /></svg>
);

const HALYK_MARK_D =
  'M36.1331 19.8337C36.6909 18.2404 36.9761 16.4409 36.9761 14.4539C36.9761 13.6166 36.6538 12.8356 36.0649 12.242C35.4822 11.6484 34.7012 11.3235 33.8706 11.3235H27.6906L23.3206 6.91849C22.7379 6.32491 21.9569 6 21.1263 6C20.2957 6 19.5209 6.32491 18.932 6.91849L14.562 11.3235H8.38203C7.55142 11.3235 6.7766 11.6484 6.18773 12.242C5.59887 12.8356 5.27654 13.6166 5.27654 14.4539V20.6834L0.906542 25.0885C-0.302181 26.3069 -0.302181 28.2938 0.906542 29.5122L6.11955 34.767C5.56168 36.3603 5.27654 38.1598 5.27654 40.1468C5.27654 40.984 5.59887 41.7651 6.18773 42.3587C6.7766 42.946 7.55142 43.2771 8.38203 43.2771H14.562L18.932 47.6822C19.5209 48.2758 20.2957 48.6007 21.1263 48.6007C21.9569 48.6007 22.7317 48.2758 23.3206 47.6822L27.6906 43.2771H33.8706C34.7012 43.2771 35.476 42.9522 36.0649 42.3587C36.6538 41.7713 36.9761 40.984 36.9761 40.1468V33.9172L41.3461 29.5122C42.5548 28.2938 42.5548 26.3069 41.3461 25.0885L36.1331 19.8337ZM6.98115 32.88L2.28263 28.1438C1.81773 27.6752 1.81773 26.9192 2.28263 26.4506L20.2957 8.29311C20.525 8.06193 20.8164 7.94321 21.1325 7.94321C21.4548 7.94321 21.7462 8.06193 21.9693 8.29311L26.4385 12.7981C30.7961 17.3406 29.7485 26.2569 21.1263 26.2569C14.0971 26.2569 9.31802 28.6312 6.96875 32.88H6.98115ZM39.9948 28.1501L21.9755 46.3138C21.7462 46.545 21.4548 46.6637 21.1387 46.6637C20.8164 46.6637 20.525 46.545 20.3019 46.3138L15.8327 41.8088C11.4751 37.2663 12.5227 28.35 21.1449 28.35C28.1741 28.35 32.9532 25.9757 35.3025 21.7269L40.001 26.4631C40.4659 26.9317 40.4659 27.6877 40.001 28.1563L39.9948 28.1501Z';

const HALYK_WORD_D = [
  'M71.558 24.4074H56.5202V11.3298H51.1832V43.2709H56.5202V29.331H71.558V43.2459H76.8949V11.3298H71.558V24.4074Z',
  'M98.6396 23.2577C97.5982 21.6582 95.1746 19.6962 91.4306 19.6962C85.9511 19.6962 80.6637 24.0013 80.6637 31.6741C80.6637 39.347 85.9511 43.652 91.4306 43.652C95.1808 43.652 97.5982 41.7151 98.6396 40.0905V43.2459H103.834V20.1023H98.6396V23.2577ZM92.379 38.7284C89.1557 38.7284 86.0255 36.2666 86.0255 31.6741C86.0255 27.0816 89.1557 24.6011 92.379 24.6011C95.6023 24.6011 98.714 27.0879 98.714 31.6741C98.714 36.2603 95.5837 38.7284 92.379 38.7284Z',
  'M113.863 35.9542V11.3298H108.669V36.6477C108.669 41.0715 110.64 43.652 114.88 43.652C115.76 43.677 116.609 43.5333 117.465 43.2459V38.5347C117.037 38.6534 116.609 38.7284 116.181 38.7284C114.781 38.7284 113.857 37.7974 113.857 35.9542H113.863Z',
  'M129.614 36.3853L123.545 20.1086H117.998L126.775 42.3149L126.539 42.9335C125.591 45.539 124.004 46.0639 122.721 46.0639C122.225 46.0889 121.723 46.0139 121.227 45.8952V50.5814C122.083 50.8938 122.957 51.0125 123.862 51.0125C128.108 51.0125 130.196 48.1695 131.969 43.5271L140.957 20.1023H135.478L129.62 36.3791L129.614 36.3853Z',
  'M154.514 30.7494L164.19 20.1023H158.14L149.511 29.6747V11.3298H144.342V43.2459H149.511V32.3739L158.784 43.2459H165.02L154.514 30.7494Z',
];

export const HalykMark = ({ size = 20, ...p }: P & { size?: number }) => (
  <svg width={size} height={size} viewBox="-0.5 5.5 43.3 43.6" fill="currentColor" aria-hidden {...p}>
    <path d={HALYK_MARK_D} />
  </svg>
);

export const HalykLogo = ({ height = 28, ...p }: P & { height?: number }) => (
  <svg height={height} width={(height * 165.5) / 45.5} viewBox="-0.5 5.5 165.5 45.5" fill="currentColor" role="img" aria-label="Halyk Bank" {...p}>
    <path d={HALYK_MARK_D} />
    {HALYK_WORD_D.map((d) => <path key={d} d={d} />)}
  </svg>
);