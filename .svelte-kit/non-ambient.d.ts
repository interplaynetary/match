
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/api" | "/api/add-entry" | "/api/matches" | "/api/search" | "/api/taxonomy";
		RouteParams(): {
			
		};
		LayoutParams(): {
			"/": Record<string, never>;
			"/api": Record<string, never>;
			"/api/add-entry": Record<string, never>;
			"/api/matches": Record<string, never>;
			"/api/search": Record<string, never>;
			"/api/taxonomy": Record<string, never>
		};
		Pathname(): "/" | "/api" | "/api/" | "/api/add-entry" | "/api/add-entry/" | "/api/matches" | "/api/matches/" | "/api/search" | "/api/search/" | "/api/taxonomy" | "/api/taxonomy/";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/robots.txt" | string & {};
	}
}