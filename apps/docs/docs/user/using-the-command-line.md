---
title: Using the Command Line
sidebar_label: Using the Command Line
---

The command line is a maintainer tool. It is used when an action needs more control than the website currently provides.

You do not need the command line to read proposals or understand treasury status. Use it only if you are responsible for operating the treasury, preparing results, paying approved proposals, or managing safety actions.

## What It Is Used For

- setting up a local treasury for testing,
- creating or funding the treasury in a controlled environment,
- creating proposals and votes during demos or maintainer workflows,
- preparing vote results after a voting period closes,
- paying approved proposals,
- pausing or unpausing the treasury when emergency signers authorize it.

## How To Think About Commands

Each command represents a treasury action. Before running one, know the proposal, amount, wallet, and treasury period you are working with. After running one, check the website or command output to confirm the treasury moved to the expected state.

## Safety Expectations

Commands can use wallet keys and can move funds. Treat them as operational actions, not casual website clicks. Use test funds in local environments, verify every address and amount, and do not run payment or pause commands unless you are responsible for that treasury action.

## When To Prefer The Website

Use the website when you want to read proposal details, check the current period, inspect vote totals, or understand whether a proposal can be voted on or paid. Use the command line when you need to perform maintainer-only work.
