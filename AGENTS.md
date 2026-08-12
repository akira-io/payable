# Agent instructions

<!-- init-jj:start -->

## Version Control: Jujutsu

This repository uses Jujutsu (`jj`) as the primary local VCS interface for
agents. Git remains the backend: remotes, GitHub, CI and external Git tooling
all keep working against the same `.git` directory.

    local agent interface = jj
    backend and interoperability = git

Detection is automatic. `jj root` succeeding means jujutsu, even though `.git`
is also present, because a colocated repository always carries both, and its index is
not the change `jj` commits.

### Use jj for local work

Inspect with `jj status`, `jj diff`, `jj log`.

Rewrite local history with `jj split`, `jj squash`, `jj rebase`, `jj edit`,
`jj abandon`.

Do not reach for the Git equivalents `git rebase`, `git commit --amend`,
`git reset`. They rewrite the same commits from the other side, and the two
views then disagree. Do not mix the two in one piece of work.

Reaching for Git out of habit is the failure to watch for, because in a
colocated repository the Git command usually succeeds and simply answers
about the wrong thing. Every inspection has a jj form:

    git status                  ->  jj status
    git diff                    ->  jj diff
    git diff --cached           ->  jj diff          (jj writes no index)
    git diff --name-only        ->  jj diff --name-only
    git log                     ->  jj log
    git rev-parse --short HEAD  ->  jj log -r @- --no-graph -T 'commit_id.short(7)'
    git branch                  ->  jj bookmark list
    git ls-remote origin        ->  jj bookmark list --all-remotes
    git fetch                   ->  jj git fetch
    git push                    ->  jj git push

The index queries are the dangerous ones. `git diff --cached` under jujutsu
returns an empty set rather than an error, because jj never writes the index.
Any check built on it reports success while missing everything, which is the
worst way for a safety check to fail.

### Identity must be configured before the first commit

A fresh jj installation has no user name or email, and a repository
initialized before they are set produces commits with an empty identity that
no remote will accept. The failure appears at push time, long after the
commit.

    jj config get user.name
    jj config get user.email

If either is missing, set them from the Git identity the repository already
uses, then repair any commit already made with the empty one:

    jj config set --user user.name "<name>"
    jj config set --user user.email "<email>"
    jj metaedit --update-author -r <revision>

Setting the config alone does not fix commits that already exist. jj says so
when it happens; the repair is the second step.

### Every finalized commit

Inspect `jj status` and `jj diff` before finalizing. If the working-copy
change covers more than one concern, `jj split` it first: one logical concern
per commit, independently understandable, reviewable and revertible.

Finalize with `jj commit -m "<message>"`. There is no separate wrapper
command: commit-guard gates `jj commit`, `jj describe` and `jj squash`
directly, so a failed validation stops the commit. `jj split` is deliberately
left open, because splitting is how a non-atomic change gets fixed.

Messages follow Conventional Commits:

    feat(storage): add the iCloud storage driver
    fix(sync): prevent duplicate synchronization
    feat(api)!: replace the authentication contract

A breaking change MUST carry `!` before the colon. A `BREAKING CHANGE:` footer
may explain the break; it does not declare one. Semver reads the subject:

    fix   -> PATCH
    feat  -> MINOR
    !     -> MAJOR   (outranks the type)

### Bookmarks are not branches

A Git branch follows you: commit, and it advances. A jj bookmark does not. It
is a named pointer at one commit, and it stays there until it is moved by
hand.

    jj bookmark create <name> -r @-      create at the last finalized commit
    jj bookmark move <name> --to @-      move it forward after committing again
    jj git push --bookmark <name>        publish it
    jj bookmark list --all-remotes       see local, @git and @origin at once

Point a bookmark at `@-`, not `@`. The working copy `@` is itself a commit,
usually empty and undescribed, so a bookmark on `@` publishes that empty
commit instead of the work.

This is the mistake to expect from anyone arriving from Git: finalize three
changes, push, and discover only the first one went, because the bookmark
never moved. After every `jj commit` that should end up on a published
bookmark, move the bookmark before pushing, or use:

    jj git push --change @-

which derives the bookmark from the change id and publishes in one step.

Bookmarks are ordinary Git refs in a colocated repository, so any Git-side
branch convention the repository already enforces keeps working unchanged.
Only the command that creates them differs.

### Track the trunk once, or it never follows the remote

The same standing-still rule applies to the trunk, and it bites harder because
it is silent.

The trap belongs to `jj git init --colocate` over a repository that already
has a remote, which is how an existing project adopts jujutsu. It prints a
hint that the remote bookmark has no local counterpart and does nothing about
it. `jj git clone` tracks on its own and is unaffected.

Left untracked, the local trunk never advances:

    main: ksrmrvtt 957eaa0d          (empty) Merge pull request #2
    main@origin: xyuyytqs fc45dde4   (empty) Merge pull request #3

The listing shows it: an untracked remote bookmark sits at the left margin as
`name@remote`, while a tracked one is indented as `@remote` under its local
name. After a fetch, `main@origin` carries the merge that just landed and
`main` still points at the previous one. Nothing errors, and work started from
the local trunk is based on a stale commit.

Fix it once, per repository, and every later fetch advances the local bookmark
on its own:

    jj bookmark track main@origin

`/init-jj` now runs this during initialization, so an adopted repository
arrives already tracked. Do it by hand only where that did not run.

### After a pull request merges

    jj git fetch                     bring the merge down
    jj bookmark list --all-remotes   confirm local, @git and @origin agree
    jj new main                      start the next change on the merged trunk

The forge usually deletes the feature bookmark when it merges, so the fetch
removes it locally too and there is nothing to clean up by hand. Check the
listing rather than assuming either way.

Starting the next change with `jj new <trunk>` matters: the working copy is
otherwise still a child of the pre-merge commit, and the next change is built
on the wrong base without any warning.

### Pull requests

Jujutsu has no pull request command. `jj git` covers clone, colocation,
export, fetch, import, init, push, remote and root, and nothing more: a pull
request is a forge concept, not a VCS one.

Publish the bookmark with `jj git push`, then open the request with the forge
CLI, `gh` for GitHub. Everything up to that point stays in jj.

### Never

Never bypass validation: no `--no-verify`, no disabled tests, no suppressed
failures, no hand-written commit-guard marker, no re-running a blocked command
unchanged.

Never push without the validation this repository requires.

Commits, pushes, bookmarks, branches and pull requests still require explicit
user authorization, exactly as before.
<!-- init-jj:end -->
