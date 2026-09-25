"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, SearchIcon, MicIcon, SettingsIcon } from "./icons";
import styles from "./BottomNav.module.css";

const items = [
  { href: "/", label: "หน้าแรก", Icon: HomeIcon },
  { href: "/search", label: "ค้นหา", Icon: SearchIcon },
  { href: "/record", label: "บันทึก", Icon: MicIcon },
  { href: "/settings", label: "ตั้งค่า", Icon: SettingsIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="เมนูหลัก">
      {items.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className={styles.item} aria-current={pathname === href ? "page" : undefined}>
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
