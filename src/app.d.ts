declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		interface PageData {
			user: {
				userId: string;
				login: string;
				name: string | null;
				avatarUrl: string | null;
			} | null;
			/** Publishable Rivet endpoint (`pk_`). Undefined in local serverless dev. */
			rivetPublicEndpoint: string | undefined;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
