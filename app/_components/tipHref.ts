/**
 * Deep-link do Tipovačky pro konkrétní zápas – obdoba `buildCompareHref` pro Porovnání.
 * Minimalistický (jen `fixtureId`): cílová stránka už má plný `UpcomingFixture` ve své
 * `days` prop, není potřeba nic dalšího serializovat do URL.
 */
export function buildTipHref(fixture: { fixtureId: number }): string {
  return `/tipovacka?fixture=${fixture.fixtureId}`;
}
