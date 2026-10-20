import type { Metadata } from "next";

import { Conversation } from "@/components/Conversation";

export const metadata: Metadata = {
  title: "Practice",
  description: "Have a spoken English conversation with Fluency.",
};

export default function PracticePage() {
  return <Conversation />;
}
