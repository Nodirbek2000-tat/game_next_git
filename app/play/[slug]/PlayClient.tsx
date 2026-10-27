"use client";

import dynamic from "next/dynamic";

// Client only: the camera, MediaPipe and WebGL do not exist on the server. The engine chunk is also
// only downloaded when this route is opened (the home page never loads it).
const PlayRoot = dynamic(() => import("./PlayRoot"), {
  ssr: false,
  loading: () => <div style={{ position: "fixed", inset: 0, background: "#07060f" }} />,
});

export default function PlayClient({ slug }: { slug: string }) {
  return <PlayRoot slug={slug} />;
}
