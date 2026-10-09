"""Finite execution allowance for durable, one-call-per-stage jobs."""
def execution_limit(job):
    if job.get('kind') != 'PROJECT_DOCUMENTATION':
        return 8
    sources = job.get('sources', [])
    if not isinstance(sources, list) or not 1 <= len(sources) <= 12:
        return 8
    # Each extraction/merge has at most two model attempts. Publication has no
    # model call. Extra two deliveries permit transient storage/queue failures.
    merges = 3 if job.get('compactMerge') else 1
    return 2 * (len(sources) + merges) + 3
