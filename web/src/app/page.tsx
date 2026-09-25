"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useAuth";
import { api } from "@/lib/api";
import type { Course, Lecture } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { BottomNav } from "@/components/BottomNav";
import { courseColor } from "@/lib/courseColors";
import styles from "./page.module.css";

export default function HomePage() {
  const session = useRequireAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    Promise.all([api.listCourses(), api.listLectures()])
      .then(([c, l]) => {
        setCourses(c);
        setLectures(l);
      })
      .finally(() => setLoading(false));
  }, [session]);

  if (session === undefined) return null;

  const courseName = (id: string | null) => courses.find((c) => c.id === id)?.name ?? "ไม่ระบุวิชา";
  const courseIdx = (id: string | null) => Math.max(0, courses.findIndex((c) => c.id === id));

  return (
    <div className={styles.wrap}>
      <main className={styles.main}>
        <h1 className={styles.title}>LectureNote</h1>

        <section>
          <h2 className={styles.h2}>วิชาเรียน</h2>
          {courses.length === 0 && !loading ? (
            <p className={styles.empty}>ยังไม่มีวิชา — เริ่มบันทึกคาบแรกได้เลย</p>
          ) : (
            <ul className={styles.courseList}>
              {courses.map((c, i) => (
                <li key={c.id}>
                  <Link href={`/courses/${c.id}`} className={styles.courseRow}>
                    <span className={styles.dot} style={{ background: courseColor(i) }} />
                    <span>{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className={styles.h2}>คาบเรียนล่าสุด</h2>
          {lectures.length === 0 && !loading ? (
            <p className={styles.empty}>ยังไม่มีการบันทึก</p>
          ) : (
            <ul className={styles.lectureList}>
              {lectures.map((l) => (
                <li key={l.id}>
                  <Link href={`/lectures/${l.id}`} className={styles.lectureRow}>
                    <span className={styles.dot} style={{ background: courseColor(courseIdx(l.course_id)) }} />
                    <span className={styles.lectureInfo}>
                      <span className={styles.lectureTitle}>{l.title || courseName(l.course_id)}</span>
                      <StatusBadge status={l.status} progress={l.progress} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
