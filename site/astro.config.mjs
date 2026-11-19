// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://rateur.github.io',
	base: '/sumi',
	trailingSlash: 'always',
	// Starlight 0.43 stopped forcing this: keeping it leaves every page's styles as they were built.
	scopedStyleStrategy: 'where',
	// The home page reads the app version from the repository's package.json.
	vite: { server: { fs: { allow: ['..'] } } },
	// The docs have no index of their own; trimming a docs URL lands on the first page.
	redirects: { '/docs': '/sumi/docs/install/', '/fr/docs': '/sumi/fr/docs/install/' },
	integrations: [
		starlight({
			title: 'Sumi',
			description: 'A free, open-source island for the top of your Windows screen.',
			logo: { src: './src/assets/mark-paper.svg' },
			components: {
				Header: './src/components/docs/Header.astro',
				ThemeProvider: './src/components/docs/ThemeProvider.astro',
				ThemeSelect: './src/components/docs/Empty.astro',
			},
			favicon: '/favicon.svg',
			// The contributing and design pages get their table of contents from the files they import.
			routeMiddleware: './src/routeData.ts',
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				fr: { label: 'Français', lang: 'fr' },
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Rateur/sumi' }],
			editLink: { baseUrl: 'https://github.com/Rateur/sumi/edit/dev/site/' },
			lastUpdated: true,
			customCss: [
				'@fontsource-variable/bricolage-grotesque/opsz.css',
				'./src/styles/theme.css',
			],
			sidebar: [
				{
					label: 'Start here',
					translations: { fr: 'Pour commencer' },
					items: ['docs/install', 'docs/privacy', 'docs/code-signing'],
				},
				{
					label: 'Features',
					translations: { fr: 'Fonctions' },
					items: ['docs/time', 'docs/fullscreen', 'docs/music', 'docs/microphone-camera'],
				},
				{
					label: 'Contribute',
					translations: { fr: 'Contribuer' },
					items: [
						{ slug: 'docs/contribute', label: 'Contributing guide', translations: { fr: 'Guide de contribution' } },
						{ slug: 'docs/design', label: 'How the island works', translations: { fr: 'Fonctionnement de l’île' } },
					],
				},
			],
		}),
	],
});
