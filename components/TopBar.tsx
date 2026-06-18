import AvatarMenu from "./AvatarMenu";
import BatteryIndicator from "./BatteryIndicator";

/** Top-right cluster on mobile: battery indicator + profile/avatar menu.
 *  Hidden on desktop (sidebar handles navigation; battery lives in the
 *  sidebar footer; the Log FAB floats independently). */
export default function TopBar() {
  return (
    <div className="topbar">
      <BatteryIndicator />
      <AvatarMenu />
    </div>
  );
}
