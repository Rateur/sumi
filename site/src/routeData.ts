import { defineRouteMiddleware, type StarlightRouteData } from '@astrojs/starlight/route-data';
import { getHeadings as guide } from '../../.github/CONTRIBUTING.md';
import { getHeadings as design } from '../../docs/design.md';

type Item = NonNullable<StarlightRouteData['toc']>['items'][number];

// These pages import their text from the repository, so Starlight sees none of its headings: give it those.
const imported: Record<string, typeof guide> = { 'docs/contribute': guide, 'docs/design': design };

export const onRequest = defineRouteMiddleware(({ locals }) => {
	const route = locals.starlightRoute;
	const headings = imported[route.entry.id];
	if (!headings || !route.toc) return;
	const { minHeadingLevel, maxHeadingLevel, items } = route.toc;
	// Each heading goes under the last one less deep, as Starlight nests its own.
	const add = (list: Item[], item: Item): void => {
		const last = list.at(-1);
		if (last && last.depth < item.depth) add(last.children, item);
		else list.push(item);
	};
	for (const h of headings()) {
		if (h.depth >= minHeadingLevel && h.depth <= maxHeadingLevel) add(items, { ...h, children: [] });
	}
});
