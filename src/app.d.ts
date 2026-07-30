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
			rivetPublicEndpoint: string;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
