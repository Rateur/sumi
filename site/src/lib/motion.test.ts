import { describe, expect, it } from 'vitest';
import { Spring } from '../../../src/lib/spring';
import { motionVars, spring } from './motion';

/** Reads a `spring()` back: its duration, and the easing as a function of time in ms. */
function parse(css: string) {
	const [, ms, body] = /^(\d+)ms linear\((.*)\)$/.exec(css)!;
	const stops = body.split(', ').map((s) => s.split(' ').map(parseFloat) as [number, number]);
	const duration = +ms;
	const at = (t: number) => {
		const p = (t / duration) * 100;
		const i = stops.findIndex(([, pct]) => pct >= p);
		if (i <= 0) return stops[Math.max(i, 0)][0];
		const [[v0, p0], [v1, p1]] = [stops[i - 1], stops[i]];
		return v0 + ((v1 - v0) * (p - p0)) / (p1 - p0);
	};
	return { duration, stops, at };
}

describe('spring', () => {
	it('traces the app spring within a fraction of a pixel per 100 px', () => {
		for (const axis of [
			[0.46, 0.26],
			[0.4, 0],
			[0.15, 0],
		] as const) {
			const { duration, at } = parse(spring(axis));
			const s = new Spring(0);
			s.to(100, axis[0], axis[1], 0);
			for (let t = 5; t < duration; t += 7) {
				s.update(t);
				expect(Math.abs(at(t) * 100 - s.value)).toBeLessThan(0.35);
			}
		}
	});

	it('starts at 0, ends at 1 and overshoots only with a bounce', () => {
		const bouncy = parse(spring([0.46, 0.26])).stops;
		const firm = parse(spring([0.4, 0])).stops;
		expect([bouncy[0], bouncy.at(-1)]).toEqual([
			[0, 0],
			[1, 100],
		]);
		expect(Math.max(...bouncy.map(([v]) => v))).toBeGreaterThan(1.02);
		expect(Math.max(...firm.map(([v]) => v))).toBeLessThanOrEqual(1);
	});

	it('names every move of the island', () => {
		const vars = motionVars();
		for (const name of ['hover', 'unhover', 'open', 'close', 'peek', 'unpeek', 'grow', 'shrink'])
			expect(vars).toMatch(new RegExp(`--${name}-w: \\d+ms linear\\(.*?\\);--${name}-h: `));
		expect(vars).toContain('--enter: 280ms cubic-bezier(0.2, 0, 0, 1);');
	});
});
