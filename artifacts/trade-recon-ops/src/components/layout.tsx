import React from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Upload, 
  Table, 
  BrainCircuit, 
  FileText 
} from "lucide-react";
import { Sidebar, SidebarHeader, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider } from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload Data", icon: Upload },
  { href: "/results", label: "Reconciliation Results", icon: Table },
  { href: "/ai-insights", label: "AI Audit Insights", icon: BrainCircuit },
  { href: "/report", label: "Export Report", icon: FileText },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar className="border-r border-border bg-card">
          <SidebarHeader className="p-4 border-b border-border">
            <div className="flex items-center gap-2 font-bold text-lg text-primary tracking-tight">
              <div className="w-6 h-6 bg-primary text-primary-foreground flex items-center justify-center rounded-sm text-xs">TR</div>
              TradeReconOps
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu className="p-2 gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.href} className="flex items-center gap-3">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <main className="flex-1 flex flex-col min-h-screen overflow-auto">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
