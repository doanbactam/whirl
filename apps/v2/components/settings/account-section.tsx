"use client";

import { useEffect, useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { IconLogin2, IconLogout } from "@tabler/icons-react";

import { AuthModal } from "@/components/auth/auth-modal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toasts";
import { SettingsCard, SettingsHeader, SettingsRow } from "./settings-rows";
import { RedeemPerkCard } from "./redeem-perk-card";

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

function clerkErrorMessage(err: unknown): string {
  const first = (err as { errors?: { longMessage?: string; message?: string }[] })
    ?.errors?.[0];
  return first?.longMessage ?? first?.message ?? "Something went wrong. Try again?";
}

export function AccountSection() {
  const clerk = useClerk();
  const { user, isLoaded } = useUser();
  const [authOpen, setAuthOpen] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const savingNamesRef = useRef(false);

  /* Re-seed when a different user signs in — but never on every render,
     or in-progress edits would be clobbered. */
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const name =
    user?.fullName ??
    user?.username ??
    user?.primaryEmailAddress?.emailAddress ??
    "You";
  const email = user?.primaryEmailAddress?.emailAddress;

  const commitNames = async () => {
    if (!user || savingNamesRef.current) return;
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (
      trimmedFirst === (user.firstName ?? "") &&
      trimmedLast === (user.lastName ?? "")
    ) {
      return;
    }

    savingNamesRef.current = true;
    try {
      await user.update({ firstName: trimmedFirst, lastName: trimmedLast });
      setFirstName(trimmedFirst);
      setLastName(trimmedLast);
    } catch (err) {
      showToast(clerkErrorMessage(err));
    } finally {
      savingNamesRef.current = false;
    }
  };

  const changePhoto = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file.");
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      showToast("Image must be 5 MB or smaller.");
      return;
    }

    const preview = URL.createObjectURL(file);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return preview;
    });
    setUploadingPhoto(true);

    try {
      await user.setProfileImage({ file });
    } catch (err) {
      setPhotoPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      showToast(clerkErrorMessage(err));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  return (
    <>
      <SettingsHeader title="Account" description="Who you are, and the door." />
      {!isLoaded ? (
        <SettingsCard>
          <div className="flex items-center gap-3 p-4">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
        </SettingsCard>
      ) : !user ? (
        <SettingsCard>
          <SettingsRow
            icon={IconLogin2}
            title="You're signed out"
            description="Sign in to sync your chats across devices."
            control={
              <Button variant="secondary" onClick={() => setAuthOpen(true)}>
                Sign in
              </Button>
            }
          />
        </SettingsCard>
      ) : (
        <div className="flex flex-col gap-4">
          <SettingsCard>
            <div className="flex items-center gap-3 p-4">
              <Avatar
                className={`size-10 transition-opacity duration-200 ${
                  uploadingPhoto ? "opacity-50" : ""
                }`}
              >
                <AvatarImage src={photoPreview ?? user.imageUrl} alt="" />
                <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">Profile photo</div>
                <p className="mt-0.5 text-[13px]/[18px] text-muted-foreground">
                  JPG, PNG, or WebP. Up to 5 MB.
                </p>
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void changePhoto(file);
                }}
              />
              <Button
                variant="secondary"
                disabled={uploadingPhoto}
                onClick={() => photoInputRef.current?.click()}
              >
                {uploadingPhoto ? "Uploading…" : "Change"}
              </Button>
            </div>
            <SettingsRow
              title="First name"
              control={
                <Input
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  onBlur={() => void commitNames()}
                  onKeyDown={blurOnEnter}
                  autoComplete="given-name"
                  aria-label="First name"
                  className="w-44"
                />
              }
            />
            <SettingsRow
              title="Last name"
              control={
                <Input
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  onBlur={() => void commitNames()}
                  onKeyDown={blurOnEnter}
                  autoComplete="family-name"
                  aria-label="Last name"
                  className="w-44"
                />
              }
            />
            {email && (
              <SettingsRow
                title="Email"
                control={
                  <span className="max-w-52 truncate text-[13px]/[18px] text-muted-foreground">
                    {email}
                  </span>
                }
              />
            )}
            <SettingsRow
              title="Email & password"
              description="Update your sign-in email or password."
              control={
                <Button
                  variant="secondary"
                  onClick={() => clerk.openUserProfile()}
                >
                  Manage
                </Button>
              }
            />
          </SettingsCard>
          <RedeemPerkCard />
          <SettingsCard>
            <SettingsRow
              title="Log out"
              description="Sign out of whirl on this device."
              control={
                <Button variant="destructive" onClick={() => void clerk.signOut()}>
                  <IconLogout size={16} />
                  Log out
                </Button>
              }
            />
          </SettingsCard>
        </div>
      )}
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}
