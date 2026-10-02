import {
  Bell,
  Home,
  Landmark,
  Layers,
  LifeBuoy,
  LineChart,
  PlusCircle,
  ReceiptText,
  Send,
  Settings,
  ShieldCheck,
  Wallet,
} from "lucide-react";

export const PRIMARY_NAV = [
  { href: "/", label: "홈", icon: Home },
  { href: "/market", label: "마켓", icon: LineChart },
  { href: "/portfolio", label: "투자", icon: Wallet },
  { href: "/orders", label: "주문", icon: ReceiptText },
];

export const MORE_NAV = [
  { href: "/margin", label: "마진", description: "레버리지 롱·숏 및 담보 관리", icon: Layers },
  { href: "/notifications", label: "알림", description: "공지·체결·송금 소식", icon: Bell },
  { href: "/transfers", label: "송금", description: "Credit·주식 보내기", icon: Send },
  { href: "/accounts", label: "계좌", description: "계좌 추가·삭제", icon: Landmark },
  { href: "/security", label: "보안", description: "패스키·세션·복구키", icon: ShieldCheck },
  { href: "/settings", label: "설정", description: "화면 알림·사용 환경", icon: Settings },
  { href: "/listings/new", label: "종목 상장", description: "새 종목 등록", icon: PlusCircle },
  { href: "/support", label: "고객센터", description: "문의 접수·답변", icon: LifeBuoy },
];

// A device-linked session can't use inquiries or listing, so those entries are
// left out instead of leading to refused pages. Its notifications are served
// already narrowed to the linked accounts and system notices.
const LINKED_HIDDEN_NAV = new Set(["/support", "/listings/new"]);

export function moreNavFor(linked: boolean): typeof MORE_NAV {
  return linked ? MORE_NAV.filter((item) => !LINKED_HIDDEN_NAV.has(item.href)) : MORE_NAV;
}
