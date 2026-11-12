// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://rateur.github.io',
	base: '/sumi',
	trailingSlash: 'always',
	// The home page reads the app version from the repository's package.json.
	vite: { server: { fs: { allow: ['..'] } } },
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
					items: ['docs/install', 'docs/privacy'],
				},
				{
					label: 'Features',
					translations: { fr: 'Fonctions' },
					items: ['docs/time'],
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
