// What the hardware Back button does on the calendar screen. Returns true when
// it handled the press (so the app stays open) and false to let the system
// close the app.
export function handleCalendarBack(opts: {
  drawerOpen: boolean;
  closeDrawer: () => void;
  goBack: () => boolean;
}): boolean {
  if (opts.drawerOpen) {
    opts.closeDrawer();
    return true;
  }
  return opts.goBack();
}
