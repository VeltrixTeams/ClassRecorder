"use client";
import { useEffect, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import type { Course, Lecture } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { ChevronLeftIcon } from "@/components/icons";
import styles from "./page.module.css";

export default function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const session = useRequireAuth();
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);

  useEffect(() => {
    if (!session) return;
    api.listCourses().then((cs) => setCourse(cs.find((c) => c.id === id) ?? null));
    api.listLectures({ course_id: id }).then(setLectures);
  }, [id, session]);

  if (session === undefined) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.crumb}>
        <button className={styles.iconBtn} aria-label="กลับ" onClick={() => router.push("/")}>
          <ChevronLeftIcon />
        </button>
      </div>
      <h1 className={styles.title}>{course?.name ?? "วิชา"}</h1>
      {course?.instructor && <p className={styles.sub}>{course.instructor}</p>}

      <h2 className={styles.h2}>คาบเรียน</h2>
      {lectures.length === 0 ? (
        <p className={styles.empty}>ยังไม่มีการบันทึกในวิชานี้</p>
      ) : (
        <ul className={styles.list}>
          {lectures.map((l) => (
            <li key={l.id}>
              <Link href={`/lectures/${l.id}`} className={styles.row}>
                <span>{l.title || new Date(l.recorded_at).toLocaleDateString("th-TH")}</span>
                <StatusBadge status={l.status} progress={l.progress} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
