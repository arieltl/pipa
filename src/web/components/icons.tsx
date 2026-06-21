export type IconName =
  | "archive"
  | "check"
  | "copy"
  | "download"
  | "edit"
  | "refresh"
  | "send"
  | "trash"
  | "undo"
  | "upload";

const PATHS: Record<IconName, string> = {
  archive:
    "M3 7h18M5 7l1 13h12l1-13M8 7V4h8v3M9 11h6",
  check: "M5 12l4 4L19 6",
  copy:
    "M8 8h10v12H8zM6 16H4V4h12v2",
  download:
    "M12 3v11m0 0l-4-4m4 4l4-4M5 19h14",
  edit:
    "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM14 8l3 3",
  refresh:
    "M20 7v5h-5M4 17v-5h5M18 9a7 7 0 0 0-11.7-2.6M6 15a7 7 0 0 0 11.7 2.6",
  send:
    "M4 4l16 8-16 8 3-8-3-8zm3 8h13",
  trash:
    "M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13",
  undo:
    "M9 7H4v5M5 11a7 7 0 1 0 2-5",
  upload:
    "M12 21V10m0 0l-4 4m4-4l4 4M5 7h14",
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      class="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
