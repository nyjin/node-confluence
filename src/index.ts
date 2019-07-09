import * as request from "request-promise-native";
import * as url from 'url';

type ContentType = 'page' | 'blogpost' | 'comment' | 'attachment';
type RepresentationType = 'view' | 'export_view' | 'styled_view' | 'storage' | 'editor2' | 'anonymous_export_view';
type StatusType = 'current' | 'trashed' | 'historical' | 'draft';

interface ContentBodyCreate {
  value: string;
  representation: RepresentationType;
}

interface ContentBody {
  view?: ContentBodyCreate;
  export_view?: ContentBodyCreate;
  styled_view?: ContentBodyCreate;
  storage?: ContentBodyCreate;
  editor2?: ContentBodyCreate;
  anonymous_export_view?: ContentBodyCreate;
}

interface BaseApiContentBody {
  title: string;
  type: ContentType;
  status?: StatusType;
  ancestors?: [] | [{id: string}];
}

interface PostApiContentBody extends BaseApiContentBody {
  id?: string;
  space: { key: string };
  body: ContentBody;
}

interface PutApiContentBody extends BaseApiContentBody {
  version: { number: number };
  body?: ContentBody;
}

export interface Content {
  id: string;
  type: string;
  status: string;
  title: string;
  space: {
    id: number;
    key: string;
    name: string;
    status: StatusType;
  };
  history: { };
  version: {
    by: { username: string; userKey: string; accountId: string; displayName: string; }
    message: string;
    number: number
  };
  body?: ContentBody;
}

export default class Confluency {

  private host: string;
  private context: string;
  private baseOptions: any;

  // tslint:disable-next-line:cyclomatic-complexity
  constructor(opts: { host: string, context?: string
      oauth?: {
        consumerKey: string;
        privateKey: string;
        token: string;
        tokenSecret: string;
        verifier?: any;
        callbackUrl?: any;
      }, request?: request}) {
    this.host = opts.host;
    opts.context = opts.context || '';
    if (opts.context.length && opts.context[0] !== '/') opts.context = '/' + opts.context;
    this.context = opts.context;
    // This is so we can fake during unit tests
    // this.request = opts.request || request;
    if (opts.oauth && opts.oauth.consumerKey && opts.oauth.token) {
      this.baseOptions = { oauth: {
        consumer_key: opts.oauth.consumerKey,
        consumer_secret: opts.oauth.privateKey,
        token: opts.oauth.token,
        token_secret: opts.oauth.tokenSecret,
        signature_method: 'RSA-SHA1'
      }};
    }
  }

  compositeUri({prefix, uri}) {
    if (uri.slice(0, prefix.length) === prefix) {
      prefix = '';
    }
    return this.host + this.context + prefix + uri;
  }

  /**
   * @name makeRequestHeader
   * @function
   * Creates a requestOptions object based on the default template for one
   * @param {string} uri
   * @param {object} [options] - an object containing fields and formatting how the
   */
  makeRequestHeader(uri, options: any) {
    return {
      rejectUnauthorized: true,
      method: options.method || 'GET',
      uri,
      json: true,
      ...options
    };
  }

  /**
   * @name doRequest
   * @function
   * Does a request based on the requestOptions object
   * @param {object} requestOptions - fields on this object get posted as a request header for
   * requests to jira
   */
  async doRequest(requestOptions) {
    const options = {
      ...this.baseOptions,
      ...requestOptions
    };

    const response = await request(options);
    if (response) {
      if (Array.isArray(response.errorMessages) && response.errorMessages.length > 0) {
        throw new Error(response.errorMessages.join(', '));
      }
    }

    return response;
  }
  newRequest(m: string, uri: string, b?: string) {
    // const prefix = !noRestApi && '/rest/api' || '';
    // const request: superagent.Request = this.client[method](this.compositeUri({prefix, uri}));

    const prefix = '/rest/api';
    const u = this.compositeUri({ prefix, uri});
    console.log(u);
    return this.doRequest(this.makeRequestHeader(u, {
      method: m,
      body: b,
      'Content-Type': 'application/json' }));
  }

  async GET(uri: string) {
    const data = await this.newRequest('GET', uri);
    return data;
  }

  async POST(uri: string, body) {
    const data = await this.newRequest('POST', uri, body);
    return data;
  }

  async PUT(uri: string, body) {
    try {
      const data = await this.newRequest('PUT', uri, body);
      return data;
    } catch (e) {
      console.error(e);
    }
  }

  async DEL(uri: string) {
    const data = await this.newRequest('DEL', uri);
    return data;
  }

  createQueryString(parameters) {
    Object.keys(parameters).forEach(key => {
      if (Array.isArray(parameters[key])) {
        parameters[key] = parameters[key].join(',');
      }

      if (!parameters[key] && typeof parameters[key] !== 'number') {
        delete parameters[key];
      }
    });
    return url.format({
      query: parameters
    });
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-get
  async getPage(pageId: string, expand?: string[]): Promise<Content> {
    let uri = '/content/' + pageId;
    uri += this.createQueryString({ expand });
    return this.GET(uri);
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-id-child-type-get
  async getChildren(pageId: string, {all= false, expand= []} = {}) {
    let uri = '/content/' + pageId + '/child/page';
    uri += this.createQueryString({ expand });
    if (all) return this._getPagesAll(uri);
    const body = await this.GET(uri);
    return body.results;
  }

  _getPagesAll(query: string, pages: string[] = []) {
    return this.GET(query).then(body => {
      pages = pages.concat(body.results);
      if (!body._links.next) return pages;
      return this._getPagesAll(body._links.next, pages);
    });
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-space-spaceKey-content-get
  async getPages(spaceKey: string, opts: {all: boolean, limit: number, expand?: string[]} = { all: false, limit: 25 }) {
    const query = '/space/' + spaceKey + '/content/page';
    if (opts.all) return this._getPagesAll(query + this.createQueryString({
      limit: opts.limit,
      expand: opts.expand
    }));
    const body = await this.GET(query);
    return body.results;
  }

  async _getSpacesAll(query: string, spaces: string[] = []) {
    const body = await this.GET(query);
    spaces = spaces.concat(body.results);
    if (!body._links.next) return spaces;
    return this._getSpacesAll(body._links.next, spaces);
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-space-get
  async getSpaces(opts: {all: boolean, limit: number} = {all: false, limit: 25}) {
    if (opts.all) return this._getSpacesAll('/space' + this.createQueryString({
      limit: opts.limit
    }));
    const body = await this.GET('/space');
    return body.results;
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-space-spaceKey-get
  getSpace(spaceKey: string) {
    return this.GET('/space/' + spaceKey);
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-post
  create(opts: {space: string, title: string, content: string, parent?: string, representation?: RepresentationType}) {
    const body: PostApiContentBody = {
      type: 'page',
      title: opts.title,
      space: {key: opts.space},
      body: {
        storage: {
          value: opts.content,
          representation: opts.representation || 'storage'
        }
      }
    };
    if (opts.parent) {
      body.ancestors = [{id: opts.parent}];
    }
    return this.POST('/content', body);
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-id-put
  update(opts: { id: string, title: string, content: string, version: number,
                 parent?: string, representation?: RepresentationType
      }) {
    const body: PutApiContentBody = {
      type: 'page',
      title: opts.title,
      version: {
        number: opts.version
      },
      body: {
        storage: {
          value: opts.content,
          representation: opts.representation || 'storage'
        }
      }
    };
    if (opts.parent) {
      body.ancestors = [{id: opts.parent}];
    }
    return this.PUT('/content/' + opts.id, body);
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-id-delete
  del(pageId: string) {
    return this.DEL('/content/' + pageId);
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-id-label-post
  tagLabel(pageId: string, label: string) {
    return this.POST(`/content/${pageId}/label`, [{prefix: 'global', name: label}]);
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-id-label-post
  tagLabels(pageId: string, labels: string[]) {
    const labelObjects = labels.map(label => ({prefix: 'global', name: label}));
    return this.POST(`/content/${pageId}/label`, labelObjects);
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-id-label-get
  async getLabels(pageId: string) {
    const body = await this.GET(`/content/${pageId}/label`);
    return body.results;
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-id-label-delete
  untagLabel(pageId: string, label: string) {
    return this.DEL(`/content/${pageId}/label` + this.createQueryString({
      name: label
    }));
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-search-get
  async search(cql: string, opts?: {limit: number}) {
    const query = {cql, limit: opts && opts.limit};
    const body = await this.GET('/content/search' + url.format({query}));
    return body.results;
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-content-id-put
  async changeParent(pageId: string, parentId: string) {
    const page = await this.getPage(pageId);
    const body: PutApiContentBody = {
      type: 'page',
      title: page.title,
      version: {number: page.version.number + 1},
      ancestors: [{id: parentId}]
    };
    return this.PUT('/content/' + pageId, body);
  }

  // https://developer.atlassian.com/cloud/confluence/rest/#api-contentbody-convert-to-post
  async convertWikiMarkup(content) {
    const body = await this.POST('/contentbody/convert/storage', {
      value: content,
      representation: 'wiki'
    });
    return body.value;
  }
}
