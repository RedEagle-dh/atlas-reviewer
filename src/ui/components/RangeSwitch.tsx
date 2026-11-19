/**
 * The range switch: which range of the review the page shows, and the choice of another. In the
 * sidebar's head, and in the header bar while the sidebar is closed, so the page always says
 * which range it shows.
 */
import { ChevronsUpDownIcon, GitCompareArrowsIcon } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { shortSha } from "../lib/files";
import { withRange } from "../router";
import { useAtlas } from "../state/atlas";
import { navigate, useRoute } from "../state/route";
import { S } from "../strings";

export function RangeSwitch({ place }: { place: "sidebar" | "header" }) {
	const { meta, model, rangeId } = useAtlas();
	const route = useRoute();
	const label = meta.ranges.find((r) => r.id === rangeId)?.label ?? rangeId;
	const choose = (id: string) =>
		// The first range is the default: keep the URL short.
		navigate(withRange(route, id === meta.ranges[0]?.id ? undefined : id));
	const menu = (trigger: ReactElement) => (
		<DropdownMenu>
			<DropdownMenuTrigger render={trigger}>
				<GitCompareArrowsIcon aria-hidden="true" />
				<span className="truncate">{label}</span>
				<ChevronsUpDownIcon className="ml-auto text-muted-foreground" aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-72">
				<DropdownMenuGroup>
					<DropdownMenuLabel>{S.range}</DropdownMenuLabel>
					<DropdownMenuRadioGroup value={rangeId} onValueChange={choose}>
						{meta.ranges.map((range) => (
							<DropdownMenuRadioItem key={range.id} value={range.id} closeOnClick>
								<span className="grid gap-0.5 py-0.5">
									<span className="font-medium">{range.label}</span>
									{range.note ? (
										<span className="text-xs text-muted-foreground">{range.note}</span>
									) : null}
									{range.id === rangeId ? (
										<span className="font-mono text-xs text-muted-foreground">
											{S.rangeShas(
												`${model.range.base.ref} (${shortSha(model.range.base.sha)})`,
												`${model.range.head.ref} (${shortSha(model.range.head.sha)})`,
											)}
										</span>
									) : null}
								</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
	if (place === "header")
		return menu(
			<Button
				variant="outline"
				size="sm"
				aria-label={S.rangeCurrent(label)}
				className="max-w-56 min-w-0 shrink font-normal"
			/>,
		);
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				{menu(<SidebarMenuButton variant="outline" aria-label={S.rangeCurrent(label)} />)}
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
