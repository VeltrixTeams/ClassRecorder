"use client";
import { useEffect } from "react";
import { resumePendingUploads } from "@/lib/uploadQueue";

/** Resumes any pending/failed upload segments on app load (recorder may have been killed mid-upload). */
export function Bootstrap() {
  useEffect(() => {
    resumePendingUploads();
  }, []);
  return null;
}
