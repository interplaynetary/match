
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```sh
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const SHELL: string;
	export const SESSION_MANAGER: string;
	export const QT_ACCESSIBILITY: string;
	export const COLORTERM: string;
	export const XDG_CONFIG_DIRS: string;
	export const NVM_INC: string;
	export const XDG_MENU_PREFIX: string;
	export const TERM_PROGRAM_VERSION: string;
	export const JOBS: string;
	export const GNOME_DESKTOP_SESSION_ID: string;
	export const NODE: string;
	export const GNOME_SHELL_SESSION_MODE: string;
	export const SSH_AUTH_SOCK: string;
	export const XDG_DATA_HOME: string;
	export const XDG_CONFIG_HOME: string;
	export const MEMORY_PRESSURE_WRITE: string;
	export const npm_config_local_prefix: string;
	export const XMODIFIERS: string;
	export const DESKTOP_SESSION: string;
	export const ANTIGRAVITY_CLI_ALIAS: string;
	export const GTK_MODULES: string;
	export const PWD: string;
	export const LOGNAME: string;
	export const XDG_SESSION_DESKTOP: string;
	export const XDG_SESSION_TYPE: string;
	export const BUN_WHICH_IGNORE_CWD: string;
	export const SYSTEMD_EXEC_PID: string;
	export const GUILE_LOAD_PATH: string;
	export const _: string;
	export const XAUTHORITY: string;
	export const VSCODE_GIT_ASKPASS_NODE: string;
	export const IM_CONFIG_CHECK_ENV: string;
	export const GJS_DEBUG_TOPICS: string;
	export const HOME: string;
	export const USERNAME: string;
	export const IM_CONFIG_PHASE: string;
	export const LANG: string;
	export const LS_COLORS: string;
	export const XDG_CURRENT_DESKTOP: string;
	export const GUILE_EXTENSIONS_PATH: string;
	export const npm_package_version: string;
	export const MEMORY_PRESSURE_WATCH: string;
	export const WAYLAND_DISPLAY: string;
	export const SBX_CHROME_API_RQ: string;
	export const GIT_ASKPASS: string;
	export const INVOCATION_ID: string;
	export const GUILE_LOAD_COMPILED_PATH: string;
	export const MANAGERPID: string;
	export const INIT_CWD: string;
	export const CHROME_DESKTOP: string;
	export const XDG_CACHE_HOME: string;
	export const INFOPATH: string;
	export const GJS_DEBUG_OUTPUT: string;
	export const NVM_DIR: string;
	export const VSCODE_GIT_ASKPASS_EXTRA_ARGS: string;
	export const GNOME_SETUP_DISPLAY: string;
	export const VSCODE_PYTHON_AUTOACTIVATE_GUARD: string;
	export const LESSCLOSE: string;
	export const XDG_SESSION_CLASS: string;
	export const TERM: string;
	export const npm_package_name: string;
	export const LESSOPEN: string;
	export const USER: string;
	export const VSCODE_GIT_IPC_HANDLE: string;
	export const CLUTTER_DISABLE_MIPMAPPED_TEXT: string;
	export const DISPLAY: string;
	export const SHLVL: string;
	export const NVM_CD_FLAGS: string;
	export const GUIX_LOCPATH: string;
	export const GSM_SKIP_SSH_AGENT_WORKAROUND: string;
	export const QT_IM_MODULE: string;
	export const npm_config_user_agent: string;
	export const XDG_STATE_HOME: string;
	export const npm_execpath: string;
	export const FC_FONTATIONS: string;
	export const XDG_RUNTIME_DIR: string;
	export const DEBUGINFOD_URLS: string;
	export const npm_package_json: string;
	export const BUN_INSTALL: string;
	export const VSCODE_GIT_ASKPASS_MAIN: string;
	export const JOURNAL_STREAM: string;
	export const XDG_DATA_DIRS: string;
	export const GDK_BACKEND: string;
	export const PATH: string;
	export const GDMSESSION: string;
	export const DBUS_SESSION_BUS_ADDRESS: string;
	export const NVM_BIN: string;
	export const GIO_LAUNCHED_DESKTOP_FILE_PID: string;
	export const npm_node_execpath: string;
	export const GIO_LAUNCHED_DESKTOP_FILE: string;
	export const TERM_PROGRAM: string;
}

/**
 * Similar to [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		SHELL: string;
		SESSION_MANAGER: string;
		QT_ACCESSIBILITY: string;
		COLORTERM: string;
		XDG_CONFIG_DIRS: string;
		NVM_INC: string;
		XDG_MENU_PREFIX: string;
		TERM_PROGRAM_VERSION: string;
		JOBS: string;
		GNOME_DESKTOP_SESSION_ID: string;
		NODE: string;
		GNOME_SHELL_SESSION_MODE: string;
		SSH_AUTH_SOCK: string;
		XDG_DATA_HOME: string;
		XDG_CONFIG_HOME: string;
		MEMORY_PRESSURE_WRITE: string;
		npm_config_local_prefix: string;
		XMODIFIERS: string;
		DESKTOP_SESSION: string;
		ANTIGRAVITY_CLI_ALIAS: string;
		GTK_MODULES: string;
		PWD: string;
		LOGNAME: string;
		XDG_SESSION_DESKTOP: string;
		XDG_SESSION_TYPE: string;
		BUN_WHICH_IGNORE_CWD: string;
		SYSTEMD_EXEC_PID: string;
		GUILE_LOAD_PATH: string;
		_: string;
		XAUTHORITY: string;
		VSCODE_GIT_ASKPASS_NODE: string;
		IM_CONFIG_CHECK_ENV: string;
		GJS_DEBUG_TOPICS: string;
		HOME: string;
		USERNAME: string;
		IM_CONFIG_PHASE: string;
		LANG: string;
		LS_COLORS: string;
		XDG_CURRENT_DESKTOP: string;
		GUILE_EXTENSIONS_PATH: string;
		npm_package_version: string;
		MEMORY_PRESSURE_WATCH: string;
		WAYLAND_DISPLAY: string;
		SBX_CHROME_API_RQ: string;
		GIT_ASKPASS: string;
		INVOCATION_ID: string;
		GUILE_LOAD_COMPILED_PATH: string;
		MANAGERPID: string;
		INIT_CWD: string;
		CHROME_DESKTOP: string;
		XDG_CACHE_HOME: string;
		INFOPATH: string;
		GJS_DEBUG_OUTPUT: string;
		NVM_DIR: string;
		VSCODE_GIT_ASKPASS_EXTRA_ARGS: string;
		GNOME_SETUP_DISPLAY: string;
		VSCODE_PYTHON_AUTOACTIVATE_GUARD: string;
		LESSCLOSE: string;
		XDG_SESSION_CLASS: string;
		TERM: string;
		npm_package_name: string;
		LESSOPEN: string;
		USER: string;
		VSCODE_GIT_IPC_HANDLE: string;
		CLUTTER_DISABLE_MIPMAPPED_TEXT: string;
		DISPLAY: string;
		SHLVL: string;
		NVM_CD_FLAGS: string;
		GUIX_LOCPATH: string;
		GSM_SKIP_SSH_AGENT_WORKAROUND: string;
		QT_IM_MODULE: string;
		npm_config_user_agent: string;
		XDG_STATE_HOME: string;
		npm_execpath: string;
		FC_FONTATIONS: string;
		XDG_RUNTIME_DIR: string;
		DEBUGINFOD_URLS: string;
		npm_package_json: string;
		BUN_INSTALL: string;
		VSCODE_GIT_ASKPASS_MAIN: string;
		JOURNAL_STREAM: string;
		XDG_DATA_DIRS: string;
		GDK_BACKEND: string;
		PATH: string;
		GDMSESSION: string;
		DBUS_SESSION_BUS_ADDRESS: string;
		NVM_BIN: string;
		GIO_LAUNCHED_DESKTOP_FILE_PID: string;
		npm_node_execpath: string;
		GIO_LAUNCHED_DESKTOP_FILE: string;
		TERM_PROGRAM: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
