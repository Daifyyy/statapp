import { TeamLogo } from "./TeamLogo";

export function TeamHeading({
  name,
  logo,
  accent,
  alignRight,
}: {
  name: string;
  logo: string;
  accent: "home" | "away";
  alignRight?: boolean;
}) {
  const color = accent === "home" ? "text-home" : "text-away";
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 sm:flex-col sm:gap-1.5 ${
        alignRight ? "flex-row-reverse text-right sm:text-center" : "sm:text-center"
      }`}
    >
      <span className="shrink-0">
        <span className="sm:hidden">
          <TeamLogo src={logo} alt={name} size={32} />
        </span>
        <span className="hidden sm:inline">
          <TeamLogo src={logo} alt={name} size={48} />
        </span>
      </span>
      <span className={`truncate text-sm font-semibold sm:text-base ${color}`}>
        {name}
      </span>
    </div>
  );
}
