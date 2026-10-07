import assert from 'node:assert/strict';
import test from 'node:test';
import { getProjectAccessState } from '../src/lib/project-access-state.ts';

const project = { projectId: 'project-1', name: 'Projekt', ownerId: 'user-1', createdAt: '' };

test('waits for a fresh access check even when cached projects exist', () => {
  assert.equal(getProjectAccessState({
    projectId: project.projectId,
    projects: [project],
    isFetchedAfterMount: false,
    isError: false,
    isFetching: true,
  }), 'checking');
});

test('grants access only when the completed API result contains the project', () => {
  assert.equal(getProjectAccessState({
    projectId: project.projectId,
    projects: [project],
    isFetchedAfterMount: true,
    isError: false,
    isFetching: false,
  }), 'granted');
});

test('returns an explicit denial when the completed API result omits the project', () => {
  assert.equal(getProjectAccessState({
    projectId: project.projectId,
    projects: [],
    isFetchedAfterMount: true,
    isError: false,
    isFetching: false,
  }), 'denied');
});

test('returns an error after a failed request and stays checking during its retry', () => {
  const failedCheck = {
    projectId: project.projectId,
    projects: undefined,
    isFetchedAfterMount: true,
    isError: true,
    isFetching: false,
  };
  assert.equal(getProjectAccessState(failedCheck), 'error');
  assert.equal(getProjectAccessState({ ...failedCheck, isFetching: true }), 'checking');
});

test('does not reset a granted state during a background refresh', () => {
  assert.equal(getProjectAccessState({
    projectId: project.projectId,
    projects: [project],
    isFetchedAfterMount: true,
    isError: false,
    isFetching: true,
  }), 'granted');
});